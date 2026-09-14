(function(){
  "use strict";

  /* =================== API =================== */
  var authToken = null;
  try { authToken = localStorage.getItem("quadrant_token") || null; } catch(e){}

  function saveToken(t){
    authToken = t;
    try { if (t) localStorage.setItem("quadrant_token", t); else localStorage.removeItem("quadrant_token"); } catch(e){}
  }

  function api(path, opts){
    opts = opts || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (authToken) headers["Authorization"] = "Bearer " + authToken;
    return fetch(path, Object.assign({}, opts, { headers: headers }))
      .catch(function(){
        throw { message: "Can't reach the server. Check your connection and try again.", network: true };
      })
      .then(function(res){
        return res.json().catch(function(){ return null; }).then(function(body){
          if (res.status === 401){
            onUnauthorized();
            throw { message: (body && body.error) || "Your session expired. Please sign in again.", unauthorized: true, status: 401 };
          }
          if (!res.ok){
            throw { message: (body && body.error) || ("Request failed (" + res.status + ")"), status: res.status };
          }
          return body;
        });
      });
  }

  function onUnauthorized(){
    saveToken(null);
    state.me = null;
    stopPolling();
    showLogin("Your session expired. Please sign in again.");
  }

  /* =================== Constants =================== */
  var STAGES = ["New","Contacted","Qualified","Proposal Sent","Won","Lost"];
  var STAGE_COLOR = {
    "New":       { bg:"var(--stage-new-bg)",       ink:"var(--stage-new-ink)" },
    "Contacted": { bg:"var(--stage-contacted-bg)", ink:"var(--stage-contacted-ink)" },
    "Qualified": { bg:"var(--stage-qualified-bg)", ink:"var(--stage-qualified-ink)" },
    "Proposal Sent": { bg:"var(--stage-proposal-bg)", ink:"var(--stage-proposal-ink)" },
    "Won":       { bg:"var(--stage-won-bg)",       ink:"var(--stage-won-ink)" },
    "Lost":      { bg:"var(--stage-lost-bg)",      ink:"var(--stage-lost-ink)" }
  };
  var USER_COLORS = [
    { bg:"#4a3aa7", ink:"#ffffff" },
    { bg:"#eb6834", ink:"#ffffff" },
    { bg:"#e87ba4", ink:"#3a0e1f" },
    { bg:"#c98500", ink:"#ffffff" },
    { bg:"#1baf7a", ink:"#ffffff" }
  ];
  var NOTE_TYPES = [
    { key:"note", label:"Note", icon:"📝" },
    { key:"call", label:"Call", icon:"📞" },
    { key:"email", label:"Email", icon:"✉️" },
    { key:"meeting", label:"Meeting", icon:"👥" }
  ];
  var POLL_LEADS_MS = 6000;
  var POLL_USERS_MS = 25000;
  var POLL_DETAIL_MS = 4000;

  /* =================== State =================== */
  var state = {
    me: null,
    users: [],
    leads: [],
    view: "board",
    search: "",
    ownerFilter: "all",
    openLeadId: null,
    openLeadContacts: [],
    openLeadNotes: []
  };
  var drawerDraft = null;
  var usersModalState = { resetForId: null, lastEmailNote: null };

  function emailStatusNote(emailResult, user){
    if (!emailResult) return null;
    var who = (user && user.name) ? escapeHtml(user.name) : "They";
    if (emailResult.sent) return { ok: true, text: who + "'ll get an email with their login." };
    if (emailResult.reason === "no_recipient") return null; // no email was given — nothing to report
    if (emailResult.reason === "not_configured") return { ok: false, text: "Account saved, but Quadrant isn't set up to send email yet — share the password yourself." };
    return { ok: false, text: "Account saved, but the email couldn't be sent — share the password yourself." };
  }
  var timers = {};

  /* =================== Helpers =================== */
  function escapeHtml(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function fmtMoney(n){
    if (n === null || n === undefined || n === "" || isNaN(n)) return "—";
    return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits:0 });
  }
  function fmtRelative(iso){
    if (!iso) return "—";
    var d = new Date(iso).getTime();
    if (isNaN(d)) return "—";
    var diff = Date.now() - d;
    var min = Math.round(diff/60000);
    if (min < 1) return "just now";
    if (min < 60) return min + "m ago";
    var hr = Math.round(min/60);
    if (hr < 24) return hr + "h ago";
    var day = Math.round(hr/24);
    if (day < 30) return day + "d ago";
    var mo = Math.round(day/30);
    if (mo < 12) return mo + "mo ago";
    return Math.round(mo/12) + "y ago";
  }
  function fmtDate(iso){
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" });
  }
  function userById(id){
    for (var i=0;i<state.users.length;i++) if (state.users[i].id === id) return state.users[i];
    return null;
  }
  function userColor(idx){ return USER_COLORS[((idx%USER_COLORS.length)+USER_COLORS.length)%USER_COLORS.length]; }
  function userIndexOf(id){
    for (var i=0;i<state.users.length;i++) if (state.users[i].id === id) return i;
    return 0;
  }
  function initials(name){
    if (!name) return "?";
    var parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
  }
  function avatarHtml(userId, size){
    var u = userById(userId);
    var idx = u ? userIndexOf(u.id) : 0;
    var c = userColor(idx);
    var cls = size === "md" ? "avatar avatar-md" : "avatar avatar-sm";
    var label = u ? escapeHtml(u.name) : "Unassigned";
    return '<span class="'+cls+'" style="background:'+c.bg+';color:'+c.ink+'" title="'+label+'">'+
      (u ? escapeHtml(initials(u.name)) : "?") + '</span>';
  }
  function chipHtml(stage){
    var c = STAGE_COLOR[stage] || STAGE_COLOR["New"];
    return '<span class="chip" style="background:'+c.bg+';color:'+c.ink+'"><span class="chip-dot"></span>'+escapeHtml(stage)+'</span>';
  }
  function isAdmin(){ return !!(state.me && state.me.role === "admin"); }

  /* =================== Login =================== */
  function showLogin(errorMsg){
    document.getElementById("appRoot").hidden = true;
    stopPolling();
    var root = document.getElementById("loginRoot");
    var html = '<div class="login-shell"><div class="login-card">';
    html += '<div class="login-brand"><svg width="26" height="26" viewBox="0 0 30 30" fill="none"><path d="M4 6H26L18 16.5V24L12 21.5V16.5L4 6Z" fill="var(--accent)"/></svg>'+
      '<span class="login-brand-name">Quadrant</span></div>';
    html += '<h1>Sign in</h1><div class="login-sub">Your placement pipeline, shared with your team.</div>';
    if (errorMsg) html += '<div class="login-error" id="loginError">'+escapeHtml(errorMsg)+'</div>';
    html += '<div class="field"><label for="loginUsername">Username</label><input id="loginUsername" type="text" autocomplete="username"></div>';
    html += '<div class="field"><label for="loginPassword">Password</label><input id="loginPassword" type="password" autocomplete="current-password"></div>';
    html += '<button class="btn btn-primary btn-block" id="loginSubmit">Sign in</button>';
    html += '</div></div>';
    root.innerHTML = html;
    root.hidden = false;

    function submit(){
      var username = document.getElementById("loginUsername").value.trim();
      var password = document.getElementById("loginPassword").value;
      if (!username || !password) return;
      var btn = document.getElementById("loginSubmit");
      btn.disabled = true; btn.textContent = "Signing in…";
      api("/api/auth/login", { method:"POST", body: JSON.stringify({ username:username, password:password }) })
        .then(function(body){
          saveToken(body.token);
          state.me = body.user;
          startApp();
        })
        .catch(function(err){
          showLogin(err.message || "Couldn't sign in.");
          setTimeout(function(){
            var u = document.getElementById("loginUsername"); if (u) u.value = username;
          }, 0);
        });
    }
    document.getElementById("loginSubmit").addEventListener("click", submit);
    document.getElementById("loginPassword").addEventListener("keydown", function(e){ if (e.key === "Enter") submit(); });
    document.getElementById("loginUsername").focus();
  }

  function logout(){
    saveToken(null);
    state.me = null;
    stopPolling();
    showLogin();
  }

  /* =================== Bootstrap =================== */
  function boot(){
    if (!authToken){ showLogin(); return; }
    api("/api/auth/me").then(function(body){
      state.me = body.user;
      startApp();
    }).catch(function(){
      showLogin();
    });
  }

  function startApp(){
    document.getElementById("loginRoot").innerHTML = "";
    document.getElementById("loginRoot").hidden = true;
    document.getElementById("appRoot").hidden = false;
    Promise.all([refreshUsers(), refreshLeads()]).then(function(){
      renderAll();
      startPolling();
    }).catch(function(err){
      renderAll();
      showApiBanner(err && err.message);
      startPolling();
    });
  }

  function showApiBanner(msg){
    var b = document.getElementById("apiBanner");
    if (!b) return;
    if (msg) document.getElementById("apiBannerText").textContent = msg;
    b.hidden = false;
  }
  function hideApiBanner(){
    var b = document.getElementById("apiBanner");
    if (b) b.hidden = true;
  }

  function refreshUsers(){
    return api("/api/users").then(function(body){
      state.users = body.users;
      hideApiBanner();
    });
  }
  function refreshLeads(){
    return api("/api/leads").then(function(body){
      var changed = JSON.stringify(body.leads) !== JSON.stringify(state.leads);
      state.leads = body.leads;
      hideApiBanner();
      if (changed) renderApp();
    }).catch(function(err){
      if (!err.unauthorized) showApiBanner(err.message);
    });
  }
  function refreshOpenLead(){
    if (!state.openLeadId) return Promise.resolve();
    return api("/api/leads/" + state.openLeadId).then(function(body){
      var idx = state.leads.findIndex(function(l){ return l.id === body.lead.id; });
      if (idx >= 0) state.leads[idx] = body.lead; else state.leads.push(body.lead);
      state.openLeadContacts = body.contacts;
      state.openLeadNotes = body.notes;
      hideApiBanner();
      renderDrawer();
    }).catch(function(err){
      if (err && err.status === 404){ closeDrawer(); return; }
      if (!err.unauthorized) showApiBanner(err.message);
    });
  }

  function startPolling(){
    stopPolling();
    timers.leads = setInterval(function(){ refreshLeads(); }, POLL_LEADS_MS);
    timers.users = setInterval(function(){ refreshUsers().then(renderAll); }, POLL_USERS_MS);
    timers.detail = setInterval(function(){ refreshOpenLead(); }, POLL_DETAIL_MS);
  }
  function stopPolling(){
    Object.keys(timers).forEach(function(k){ clearInterval(timers[k]); });
    timers = {};
  }

  /* =================== Mutations =================== */
  function addLead(data){
    return api("/api/leads", { method:"POST", body: JSON.stringify(data) }).then(function(body){
      state.leads.unshift(body.lead);
      openLead(body.lead.id);
      renderApp();
    });
  }
  function updateLeadFields(leadId, fields){
    return api("/api/leads/" + leadId, { method:"PATCH", body: JSON.stringify(fields) }).then(function(body){
      var idx = state.leads.findIndex(function(l){ return l.id === leadId; });
      if (idx >= 0) state.leads[idx] = body.lead;
      renderApp();
      if (state.openLeadId === leadId) renderDrawer();
    }).catch(function(err){ showApiBanner(err.message); });
  }
  function changeStage(leadId, newStage){
    var lead = state.leads.find(function(l){ return l.id === leadId; });
    if (!lead || lead.stage === newStage) return;
    updateLeadFields(leadId, { stage:newStage }).then(function(){ refreshOpenLead(); });
  }
  function deleteLead(leadId){
    api("/api/leads/" + leadId, { method:"DELETE" }).then(function(){
      state.leads = state.leads.filter(function(l){ return l.id !== leadId; });
      closeDrawer();
      renderApp();
    }).catch(function(err){ alert(err.message || "Couldn't delete this lead."); });
  }
  function addContact(leadId, data){
    return api("/api/leads/" + leadId + "/contacts", { method:"POST", body: JSON.stringify(data) })
      .then(function(){ return refreshOpenLead(); })
      .then(function(){ return refreshLeads(); });
  }
  function setPrimaryContact(leadId, contactId){
    return api("/api/leads/" + leadId + "/contacts/" + contactId, { method:"PATCH", body: JSON.stringify({ isPrimary:true }) })
      .then(function(){ return refreshOpenLead(); })
      .then(function(){ return refreshLeads(); });
  }
  function deleteContact(leadId, contactId){
    return api("/api/leads/" + leadId + "/contacts/" + contactId, { method:"DELETE" })
      .then(function(){ return refreshOpenLead(); })
      .then(function(){ return refreshLeads(); });
  }
  function addNote(leadId, type, text){
    return api("/api/leads/" + leadId + "/notes", { method:"POST", body: JSON.stringify({ type:type, text:text }) })
      .then(function(){ return refreshOpenLead(); });
  }

  /* =================== Derived =================== */
  function filteredLeads(){
    var q = state.search.trim().toLowerCase();
    return state.leads.filter(function(l){
      if (state.ownerFilter !== "all" && l.ownerId !== state.ownerFilter) return false;
      if (!q) return true;
      var hay = (l.companyName+" "+(l.primaryContactName||"")+" "+(l.industry||"")).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }
  function stats(){
    var open = state.leads.filter(function(l){ return l.stage!=="Won" && l.stage!=="Lost"; });
    var won = state.leads.filter(function(l){ return l.stage==="Won"; });
    var lost = state.leads.filter(function(l){ return l.stage==="Lost"; });
    var closed = won.length + lost.length;
    var winRate = closed === 0 ? null : Math.round((won.length/closed)*100);
    return { openCount: open.length, wonCount: won.length, winRate: winRate };
  }

  /* =================== Rendering: shell =================== */
  function renderAll(){
    renderIdentity();
    renderApp();
    renderDrawer();
  }

  function renderIdentity(){
    var box = document.getElementById("identityBox");
    if (!state.me){ box.innerHTML = ""; return; }
    var html = '';
    html += '<div class="identity-select">';
    html += '<div><div class="identity-name">'+escapeHtml(state.me.name)+'</div>';
    html += '<div class="identity-role">'+(isAdmin()?"Admin":"Rep")+'</div></div>';
    html += '</div>';
    if (isAdmin()){
      html += '<button class="icon-btn" id="manageUsersBtn" title="Manage users" aria-label="Manage users">'+
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 14c.7-2.8 2.9-4.3 5.5-4.3s4.8 1.5 5.5 4.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'+
        '</button>';
    }
    html += '<button class="icon-btn" id="logoutBtn" title="Log out" aria-label="Log out">'+
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10.5 11.5 14 8l-3.5-3.5M14 8H6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'+
      '</button>';
    box.innerHTML = html;
    if (isAdmin()) document.getElementById("manageUsersBtn").addEventListener("click", openManageUsers);
    document.getElementById("logoutBtn").addEventListener("click", function(){
      if (confirm("Log out of Quadrant?")) logout();
    });
  }

  function captureAppFocus(){
    var el = document.activeElement;
    var appEl = document.getElementById("app");
    if (!el || !el.id || !appEl || !appEl.contains(el)) return null;
    var info = { id: el.id };
    if (typeof el.selectionStart === "number"){ info.start = el.selectionStart; info.end = el.selectionEnd; }
    return info;
  }
  function restoreAppFocus(info){
    if (!info) return;
    var el = document.getElementById(info.id);
    if (!el) return;
    el.focus();
    if (info.start != null && el.setSelectionRange){
      try { el.setSelectionRange(info.start, info.end); } catch(e){}
    }
  }
  function renderApp(){
    var app = document.getElementById("app");
    if (!state.me) return;
    var focusInfo = captureAppFocus();
    var s = stats();
    var html = "";
    html += statsHtml(s);
    html += toolbarHtml();
    html += '<div id="viewHost"></div>';
    app.innerHTML = html;
    wireToolbar();

    var host = document.getElementById("viewHost");
    if (!state.leads.length){
      host.innerHTML = emptyStateHtml(
        "No leads yet",
        "Add the first client company you're prospecting for placements.",
        "Add a lead", "addFirstLeadBtn"
      );
      document.getElementById("addFirstLeadBtn").addEventListener("click", openNewLead);
      restoreAppFocus(focusInfo);
      return;
    }
    if (state.view === "board") host.innerHTML = boardHtml();
    else host.innerHTML = tableHtml();
    wireView();
    restoreAppFocus(focusInfo);
  }

  function emptyStateHtml(title, body, btnLabel, btnId){
    var html = '<div class="empty-state">';
    html += '<svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M6 9h28l-11 13v9l-6-3v-6L6 9Z" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/></svg>';
    html += '<h2>'+escapeHtml(title)+'</h2><p>'+escapeHtml(body)+'</p>';
    if (btnLabel) html += '<button class="btn btn-primary" id="'+btnId+'">'+escapeHtml(btnLabel)+'</button>';
    html += '</div>';
    return html;
  }

  function statsHtml(s){
    var html = '<div class="stats">';
    html += statTile("Open leads", s.openCount, "In New → Proposal Sent");
    html += statTile("Active clients", s.wonCount, "Leads marked Won");
    html += statTile("Win rate", s.winRate===null ? "—" : s.winRate+"%", "Of closed leads");
    html += '</div>';
    return html;
  }
  function statTile(label, value, sub){
    return '<div class="stat"><div class="stat-label">'+escapeHtml(label)+'</div>'+
      '<div class="stat-value mono">'+escapeHtml(String(value))+'</div>'+
      '<div class="stat-sub">'+escapeHtml(sub)+'</div></div>';
  }

  function toolbarHtml(){
    var html = '<div class="toolbar">';
    html += '<div class="search"><svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M13 13l-3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'+
      '<input id="searchInput" type="text" placeholder="Search company, contact, industry…" value="'+escapeHtml(state.search)+'" aria-label="Search leads"></div>';
    html += '<select class="filter" id="ownerFilter" aria-label="Filter by owner"><option value="all">All owners</option>';
    state.users.forEach(function(u){
      html += '<option value="'+u.id+'"'+(state.ownerFilter===u.id?' selected':'')+'>'+escapeHtml(u.name)+'</option>';
    });
    html += '</select>';
    html += '<div class="view-toggle"><button id="viewBoardBtn" aria-pressed="'+(state.view==="board")+'">Board</button>'+
      '<button id="viewTableBtn" aria-pressed="'+(state.view==="table")+'">Table</button></div>';
    html += '<button class="btn btn-primary" id="newLeadBtn">+ New lead</button>';
    html += '</div>';
    return html;
  }
  function wireToolbar(){
    document.getElementById("searchInput").addEventListener("input", function(){
      state.search = this.value; renderApp();
    });
    document.getElementById("ownerFilter").addEventListener("change", function(){ state.ownerFilter = this.value; renderApp(); });
    document.getElementById("viewBoardBtn").addEventListener("click", function(){ state.view="board"; renderApp(); });
    document.getElementById("viewTableBtn").addEventListener("click", function(){ state.view="table"; renderApp(); });
    document.getElementById("newLeadBtn").addEventListener("click", openNewLead);
  }

  function boardHtml(){
    var leads = filteredLeads();
    var html = '<div class="board">';
    STAGES.forEach(function(stage){
      var c = STAGE_COLOR[stage];
      var items = leads.filter(function(l){ return l.stage === stage; });
      html += '<div class="col" data-stage="'+stage+'" style="--c:'+c.bg+'">';
      html += '<div class="col-head"><span class="col-head-title">'+escapeHtml(stage)+'</span><span class="col-head-count">'+items.length+'</span></div>';
      html += '<div class="col-body" data-drop-stage="'+stage+'">';
      if (!items.length){ html += '<div class="col-empty">No leads</div>'; }
      items.forEach(function(l){ html += cardHtml(l); });
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }
  function cardHtml(l){
    var html = '<div class="card" draggable="true" data-lead-id="'+l.id+'">';
    html += '<div class="card-title">'+escapeHtml(l.companyName)+'</div>';
    if (l.industry) html += '<div class="card-industry">'+escapeHtml(l.industry)+'</div>';
    if (l.primaryContactName) html += '<div class="card-contact">'+escapeHtml(l.primaryContactName)+'</div>';
    html += '<div class="card-foot">'+avatarHtml(l.ownerId,"sm")+
      '<span class="card-value mono">'+fmtMoney(l.value)+'</span></div>';
    html += '<div class="card-meta">Updated '+fmtRelative(l.lastActivityAt||l.updatedAt)+'</div>';
    html += '</div>';
    return html;
  }

  function tableHtml(){
    var leads = filteredLeads().slice().sort(function(a,b){
      return new Date(b.updatedAt||0) - new Date(a.updatedAt||0);
    });
    var html = '<div class="table-wrap"><table><thead><tr>'+
      '<th>Company</th><th>Stage</th><th>Owner</th><th>Primary contact</th><th>Value</th><th>Last activity</th><th>Created</th>'+
      '</tr></thead><tbody>';
    leads.forEach(function(l){
      html += '<tr class="row-clickable" data-lead-id="'+l.id+'">';
      html += '<td class="cell-company">'+escapeHtml(l.companyName)+'</td>';
      html += '<td>'+chipHtml(l.stage)+'</td>';
      html += '<td>'+avatarHtml(l.ownerId,"sm")+' <span style="margin-left:6px">'+escapeHtml(userById(l.ownerId)?userById(l.ownerId).name:"—")+'</span></td>';
      html += '<td>'+escapeHtml(l.primaryContactName||"—")+'</td>';
      html += '<td class="mono">'+fmtMoney(l.value)+'</td>';
      html += '<td>'+fmtRelative(l.lastActivityAt||l.updatedAt)+'</td>';
      html += '<td>'+fmtDate(l.createdAt)+'</td>';
      html += '</tr>';
    });
    if (!leads.length){
      html += '<tr><td colspan="7" style="text-align:center;color:var(--ink-muted);padding:28px">No leads match your filters</td></tr>';
    }
    html += '</tbody></table></div>';
    return html;
  }

  function wireView(){
    if (state.view === "board"){
      document.querySelectorAll(".card").forEach(function(card){
        card.addEventListener("click", function(){ openLead(card.getAttribute("data-lead-id")); });
        card.addEventListener("dragstart", function(e){
          card.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", card.getAttribute("data-lead-id"));
        });
        card.addEventListener("dragend", function(){ card.classList.remove("dragging"); });
      });
      document.querySelectorAll(".col-body").forEach(function(col){
        col.addEventListener("dragover", function(e){ e.preventDefault(); col.classList.add("dragover"); });
        col.addEventListener("dragleave", function(){ col.classList.remove("dragover"); });
        col.addEventListener("drop", function(e){
          e.preventDefault(); col.classList.remove("dragover");
          var leadId = e.dataTransfer.getData("text/plain");
          var stage = col.getAttribute("data-drop-stage");
          if (leadId && stage) changeStage(leadId, stage);
        });
      });
    } else {
      document.querySelectorAll("tr.row-clickable").forEach(function(row){
        row.addEventListener("click", function(){ openLead(row.getAttribute("data-lead-id")); });
      });
    }
  }

  /* =================== Manage users modal (admin) =================== */
  function openManageUsers(){
    usersModalState.resetForId = null;
    refreshUsers().then(renderUsersModal);
    renderUsersModal();
  }
  function renderUsersModal(){
    var root = document.getElementById("modalRoot");
    usersModalState.opened = true;

    var html = '<div class="overlay" id="usersOverlay"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="usersTitle">';
    html += '<h3 id="usersTitle">Team &amp; access</h3><div class="modal-sub">Everyone who can sign in to Quadrant.</div>';
    if (usersModalState.lastEmailNote){
      html += '<div class="form-'+(usersModalState.lastEmailNote.ok?'success':'error')+'" style="margin:10px 0">'+usersModalState.lastEmailNote.text+'</div>';
    }

    state.users.forEach(function(u, i){
      var c = userColor(i);
      html += '<div class="user-row" data-user-id="'+u.id+'">';
      html += '<span class="avatar avatar-md" style="background:'+c.bg+';color:'+c.ink+'">'+escapeHtml(initials(u.name))+'</span>';
      html += '<div><div class="user-row-name">'+escapeHtml(u.name)+'</div><div class="user-row-username">@'+escapeHtml(u.username)+(u.email?' &middot; '+escapeHtml(u.email):'')+'</div></div>';
      html += '<div class="user-row-actions">';
      html += '<span class="role-badge '+(u.role==="admin"?"admin":"rep")+'">'+(u.role==="admin"?"Admin":"Rep")+'</span>';
      if (!u.active) html += '<span class="role-badge inactive">Inactive</span>';
      if (u.id !== state.me.id){
        html += '<button class="mini-btn" data-action="toggleRole" title="Switch role">'+(u.role==="admin"?"Make rep":"Make admin")+'</button>';
        html += '<button class="mini-btn" data-action="toggleActive" title="'+(u.active?"Deactivate":"Reactivate")+'">'+(u.active?"Deactivate":"Reactivate")+'</button>';
      }
      html += '<button class="mini-btn" data-action="resetPassword" title="Set new password">Reset password</button>';
      html += '</div></div>';
      if (usersModalState.resetForId === u.id){
        html += '<div class="field-row" style="margin:8px 0 4px" data-reset-row="'+u.id+'">'+
          '<div class="field" style="margin-bottom:0"><input type="password" id="resetPw_'+u.id+'" placeholder="New password (min 8 characters)"></div>'+
          '<button class="btn btn-primary" data-action="saveReset" style="flex:none">Save</button>'+
          '<button class="btn btn-ghost" data-action="cancelReset" style="flex:none">Cancel</button>'+
          '</div>';
        if (!u.email){
          html += '<div class="modal-sub" style="margin:-4px 0 4px">No email on file for '+escapeHtml(u.name)+' — you\'ll need to share the new password yourself.</div>';
        }
      }
    });

    html += '<div class="section-title" style="margin-top:18px">Add someone</div>';
    html += '<div class="modal-sub" style="margin-top:-6px">Add an email to have Quadrant send them their login automatically.</div>';
    html += '<div id="addUserError"></div>';
    html += '<div class="field"><label for="nu_name">Name</label><input id="nu_name" type="text"></div>';
    html += '<div class="field-row"><div class="field"><label for="nu_username">Username</label><input id="nu_username" type="text" placeholder="e.g. jsmith"></div>'+
      '<div class="field"><label for="nu_role">Role</label><select id="nu_role"><option value="rep">Rep</option><option value="admin">Admin</option></select></div></div>';
    html += '<div class="field"><label for="nu_email">Email (optional)</label><input id="nu_email" type="email" placeholder="jane@company.com"></div>';
    html += '<div class="field"><label for="nu_password">Temporary password</label><input id="nu_password" type="text" placeholder="At least 8 characters"></div>';
    html += '<button class="btn btn-primary btn-block" id="addUserBtn">Add user</button>';

    html += '<div class="modal-actions"><button class="btn btn-ghost" id="closeUsersBtn">Done</button></div>';
    html += '</div></div>';
    root.innerHTML = html;

    document.getElementById("closeUsersBtn").addEventListener("click", function(){ root.innerHTML=""; usersModalState.opened=false; usersModalState.lastEmailNote=null; });
    document.getElementById("usersOverlay").addEventListener("click", function(e){ if (e.target.id==="usersOverlay"){ root.innerHTML=""; usersModalState.opened=false; usersModalState.lastEmailNote=null; } });

    document.querySelectorAll("[data-action='toggleRole']").forEach(function(btn){
      btn.addEventListener("click", function(){
        var id = btn.closest(".user-row").getAttribute("data-user-id");
        var u = userById(id);
        api("/api/users/"+id, { method:"PATCH", body: JSON.stringify({ role: u.role==="admin"?"rep":"admin" }) })
          .then(function(){ return refreshUsers(); }).then(renderUsersModal).then(renderAll)
          .catch(function(err){ alert(err.message); });
      });
    });
    document.querySelectorAll("[data-action='toggleActive']").forEach(function(btn){
      btn.addEventListener("click", function(){
        var id = btn.closest(".user-row").getAttribute("data-user-id");
        var u = userById(id);
        api("/api/users/"+id, { method:"PATCH", body: JSON.stringify({ active: !u.active }) })
          .then(function(){ return refreshUsers(); }).then(renderUsersModal).then(renderAll)
          .catch(function(err){ alert(err.message); });
      });
    });
    document.querySelectorAll("[data-action='resetPassword']").forEach(function(btn){
      btn.addEventListener("click", function(){
        var id = btn.closest(".user-row").getAttribute("data-user-id");
        usersModalState.resetForId = id;
        renderUsersModal();
        var input = document.getElementById("resetPw_"+id);
        if (input) input.focus();
      });
    });
    document.querySelectorAll("[data-action='cancelReset']").forEach(function(btn){
      btn.addEventListener("click", function(){ usersModalState.resetForId = null; renderUsersModal(); });
    });
    document.querySelectorAll("[data-action='saveReset']").forEach(function(btn){
      btn.addEventListener("click", function(){
        var row = btn.closest("[data-reset-row]");
        var id = row.getAttribute("data-reset-row");
        var pw = document.getElementById("resetPw_"+id).value;
        if (!pw || pw.length < 8){ alert("Password must be at least 8 characters."); return; }
        api("/api/users/"+id, { method:"PATCH", body: JSON.stringify({ password: pw }) })
          .then(function(body){
            usersModalState.resetForId = null;
            usersModalState.lastEmailNote = emailStatusNote(body && body.email, body && body.user);
            renderUsersModal();
          })
          .catch(function(err){ alert(err.message); });
      });
    });
    document.getElementById("addUserBtn").addEventListener("click", function(){
      var name = document.getElementById("nu_name").value.trim();
      var username = document.getElementById("nu_username").value.trim();
      var role = document.getElementById("nu_role").value;
      var email = document.getElementById("nu_email").value.trim();
      var password = document.getElementById("nu_password").value;
      var errBox = document.getElementById("addUserError");
      errBox.innerHTML = "";
      if (!name || !username || !password){
        errBox.innerHTML = '<div class="form-error">Name, username and password are all required.</div>';
        return;
      }
      api("/api/users", { method:"POST", body: JSON.stringify({ name:name, username:username, password:password, role:role, email:email }) })
        .then(function(body){
          usersModalState.lastEmailNote = emailStatusNote(body && body.email, body && body.user);
          return refreshUsers();
        })
        .then(function(){ renderUsersModal(); renderApp(); })
        .catch(function(err){ errBox.innerHTML = '<div class="form-error">'+escapeHtml(err.message)+'</div>'; });
    });
  }

  /* =================== New lead modal =================== */
  function openNewLead(){
    var root = document.getElementById("modalRoot");
    var userOptions = state.users.filter(function(u){ return u.active; }).map(function(u){
      return '<option value="'+u.id+'"'+(u.id===state.me.id?' selected':'')+'>'+escapeHtml(u.name)+'</option>';
    }).join("");
    var html = '<div class="overlay" id="leadOverlay"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="leadTitle">';
    html += '<h3 id="leadTitle">New lead</h3><div class="modal-sub">A client company you\'re prospecting for placements.</div>';
    html += '<div id="newLeadError"></div>';
    html += '<div class="field"><label for="f_company">Company name</label><input id="f_company" type="text" required></div>';
    html += '<div class="field-row"><div class="field"><label for="f_industry">Industry</label><input id="f_industry" type="text" placeholder="e.g. Manufacturing"></div>'+
      '<div class="field"><label for="f_value">Est. value</label><input id="f_value" type="number" min="0" placeholder="25000"></div></div>';
    html += '<div class="field-row"><div class="field"><label for="f_website">Website</label><input id="f_website" type="text" placeholder="company.com"></div>'+
      '<div class="field"><label for="f_source">Source</label><input id="f_source" type="text" placeholder="Referral, cold call…"></div></div>';
    html += '<div class="field"><label for="f_owner">Owner</label><select id="f_owner">'+userOptions+'</select></div>';
    html += '<div class="section-title" style="margin-top:4px">First contact (optional)</div>';
    html += '<div class="field-row"><div class="field"><label for="f_cname">Name</label><input id="f_cname" type="text"></div>'+
      '<div class="field"><label for="f_ctitle">Title</label><input id="f_ctitle" type="text"></div></div>';
    html += '<div class="field-row"><div class="field"><label for="f_cemail">Email</label><input id="f_cemail" type="email"></div>'+
      '<div class="field"><label for="f_cphone">Phone</label><input id="f_cphone" type="text"></div></div>';
    html += '<div class="modal-actions"><button class="btn btn-ghost" id="cancelLeadBtn">Cancel</button><button class="btn btn-primary" id="saveLeadBtn">Add lead</button></div>';
    html += '</div></div>';
    root.innerHTML = html;
    document.getElementById("cancelLeadBtn").addEventListener("click", function(){ root.innerHTML=""; });
    document.getElementById("leadOverlay").addEventListener("click", function(e){ if (e.target.id==="leadOverlay") root.innerHTML=""; });
    document.getElementById("saveLeadBtn").addEventListener("click", function(){
      var company = document.getElementById("f_company").value.trim();
      var errBox = document.getElementById("newLeadError");
      if (!company){ errBox.innerHTML = '<div class="form-error">Company name is required.</div>'; document.getElementById("f_company").focus(); return; }
      addLead({
        companyName: company,
        industry: document.getElementById("f_industry").value,
        value: document.getElementById("f_value").value,
        website: document.getElementById("f_website").value,
        source: document.getElementById("f_source").value,
        ownerId: document.getElementById("f_owner").value,
        contactName: document.getElementById("f_cname").value,
        contactTitle: document.getElementById("f_ctitle").value,
        contactEmail: document.getElementById("f_cemail").value,
        contactPhone: document.getElementById("f_cphone").value
      }).then(function(){ root.innerHTML = ""; })
        .catch(function(err){ errBox.innerHTML = '<div class="form-error">'+escapeHtml(err.message)+'</div>'; });
    });
    document.getElementById("f_company").focus();
  }

  /* =================== Detail drawer =================== */
  function openLead(leadId){
    state.openLeadId = leadId;
    state.openLeadContacts = [];
    state.openLeadNotes = [];
    var lead = state.leads.find(function(l){ return l.id === leadId; });
    initDrawerDraft(lead);
    renderDrawer();
    refreshOpenLead();
  }
  function closeDrawer(){
    state.openLeadId = null;
    drawerDraft = null;
    state.openLeadContacts = [];
    state.openLeadNotes = [];
    renderDrawer();
  }
  function initDrawerDraft(lead){
    drawerDraft = {
      companyName: (lead && lead.companyName) || "",
      industry: (lead && lead.industry) || "",
      value: (lead && lead.value != null) ? String(lead.value) : "",
      website: (lead && lead.website) || "",
      source: (lead && lead.source) || "",
      noteText: "",
      noteType: "note",
      contactFormOpen: false,
      nc_name: "", nc_title: "", nc_email: "", nc_phone: ""
    };
  }
  function captureFocus(root){
    var el = document.activeElement;
    if (!el || !el.id || !root.contains(el)) return null;
    var info = { id: el.id };
    if (typeof el.selectionStart === "number"){ info.start = el.selectionStart; info.end = el.selectionEnd; }
    return info;
  }
  function restoreFocus(info){
    if (!info) return;
    var el = document.getElementById(info.id);
    if (!el) return;
    el.focus();
    if (info.start != null && el.setSelectionRange){
      try { el.setSelectionRange(info.start, info.end); } catch(e){}
    }
  }
  function renderDrawer(){
    var root = document.getElementById("drawerRoot");
    if (!state.openLeadId){ root.innerHTML = ""; return; }
    var lead = state.leads.find(function(l){ return l.id === state.openLeadId; });
    if (!lead){ root.innerHTML = ""; return; }
    if (!drawerDraft) initDrawerDraft(lead);

    var focusInfo = captureFocus(root);

    var committedMap = { drawerCompanyName:"companyName", d_industry:"industry", d_website:"website", d_source:"source" };
    Object.keys(committedMap).forEach(function(inputId){
      if (!focusInfo || focusInfo.id !== inputId){
        drawerDraft[committedMap[inputId]] = lead[committedMap[inputId]] || "";
      }
    });
    if (!focusInfo || focusInfo.id !== "d_value"){
      drawerDraft.value = lead.value != null ? String(lead.value) : "";
    }

    var stageOptions = STAGES.map(function(s){
      return '<option value="'+s+'"'+(s===lead.stage?' selected':'')+'>'+s+'</option>';
    }).join("");
    var userOptions = state.users.filter(function(u){ return u.active || u.id===lead.ownerId; }).map(function(u){
      return '<option value="'+u.id+'"'+(u.id===lead.ownerId?' selected':'')+'>'+escapeHtml(u.name)+'</option>';
    }).join("");

    var html = '<div class="drawer-backdrop" id="drawerBackdrop"></div>';
    html += '<div class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerCompanyName">';
    html += '<div class="drawer-head">';
    html += '<div class="drawer-head-top">';
    html += '<input id="drawerCompanyName" class="drawer-title-input" value="'+escapeHtml(drawerDraft.companyName)+'" aria-label="Company name">';
    html += '<button class="icon-btn" id="closeDrawerBtn" aria-label="Close">✕</button>';
    html += '</div>';
    html += '<div class="drawer-row">';
    html += '<select id="drawerStage" class="filter" aria-label="Stage">'+stageOptions+'</select>';
    html += '<select id="drawerOwner" class="filter" aria-label="Owner">'+userOptions+'</select>';
    if (isAdmin()) html += '<button class="btn-danger-text" id="deleteLeadBtn" style="margin-left:auto">Delete lead</button>';
    html += '</div></div>';

    html += '<div class="drawer-body">';

    html += '<div><div class="section-title">Company details</div><div class="info-grid">';
    html += '<div class="field"><label for="d_industry">Industry</label><input id="d_industry" type="text" value="'+escapeHtml(drawerDraft.industry)+'"></div>';
    html += '<div class="field"><label for="d_value">Est. value</label><input id="d_value" type="number" min="0" value="'+escapeHtml(drawerDraft.value)+'"></div>';
    html += '<div class="field"><label for="d_website">Website</label><input id="d_website" type="text" value="'+escapeHtml(drawerDraft.website)+'"></div>';
    html += '<div class="field"><label for="d_source">Source</label><input id="d_source" type="text" value="'+escapeHtml(drawerDraft.source)+'"></div>';
    html += '</div></div>';

    html += '<div><div class="section-title">Contacts</div>';
    if (!state.openLeadContacts.length){
      html += '<div style="font-size:12.5px;color:var(--ink-muted)">No contacts yet.</div>';
    }
    state.openLeadContacts.forEach(function(c){
      html += '<div class="contact-item" data-contact-id="'+c.id+'">';
      html += '<div class="contact-actions">';
      if (!c.isPrimary) html += '<button class="mini-btn" data-action="setPrimary" title="Make primary">☆</button>';
      html += '<button class="mini-btn" data-action="deleteContact" title="Remove contact">✕</button>';
      html += '</div>';
      html += '<div class="contact-name-row">'+(c.isPrimary?'<span class="primary-star">★</span>':'')+escapeHtml(c.name)+'</div>';
      if (c.title) html += '<div class="contact-title">'+escapeHtml(c.title)+'</div>';
      if (c.email) html += '<div class="contact-detail">'+escapeHtml(c.email)+'</div>';
      if (c.phone) html += '<div class="contact-detail">'+escapeHtml(c.phone)+'</div>';
      html += '</div>';
    });
    html += '<button class="btn-text" id="addContactToggle" style="margin-top:8px">'+(drawerDraft.contactFormOpen?'− Hide form':'+ Add contact')+'</button>';
    html += '<div id="addContactForm"'+(drawerDraft.contactFormOpen?'':' hidden')+' style="margin-top:10px">'+
      '<div class="field-row"><div class="field"><label for="nc_name">Name</label><input id="nc_name" type="text" value="'+escapeHtml(drawerDraft.nc_name)+'"></div>'+
      '<div class="field"><label for="nc_title">Title</label><input id="nc_title" type="text" value="'+escapeHtml(drawerDraft.nc_title)+'"></div></div>'+
      '<div class="field-row"><div class="field"><label for="nc_email">Email</label><input id="nc_email" type="email" value="'+escapeHtml(drawerDraft.nc_email)+'"></div>'+
      '<div class="field"><label for="nc_phone">Phone</label><input id="nc_phone" type="text" value="'+escapeHtml(drawerDraft.nc_phone)+'"></div></div>'+
      '<div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn btn-ghost" id="cancelContactBtn">Cancel</button><button class="btn btn-primary" id="saveContactBtn">Save contact</button></div>'+
      '</div>';
    html += '</div>';

    html += '<div><div class="section-title">Notes &amp; activity</div>';
    html += '<div class="composer">';
    html += '<textarea id="noteText" placeholder="Log a call, email, meeting or note…" aria-label="Note text">'+escapeHtml(drawerDraft.noteText)+'</textarea>';
    html += '<div class="composer-row"><select id="noteType" aria-label="Activity type">'+
      NOTE_TYPES.map(function(t){ return '<option value="'+t.key+'"'+(t.key===drawerDraft.noteType?' selected':'')+'>'+t.icon+' '+t.label+'</option>'; }).join("")+
      '</select><button class="btn btn-primary" id="logNoteBtn" style="margin-left:auto">Log</button></div>';
    html += '</div>';
    html += '<div class="timeline">';
    if (!state.openLeadNotes.length){
      html += '<div style="font-size:12.5px;color:var(--ink-muted)">No activity logged yet.</div>';
    }
    state.openLeadNotes.forEach(function(n){
      var isSystem = n.type === "system";
      var meta = NOTE_TYPES.filter(function(t){ return t.key===n.type; })[0];
      var icon = isSystem ? "•" : (meta ? meta.icon : "📝");
      html += '<div class="tl-item'+(isSystem?' system':'')+'">';
      html += '<div class="tl-icon">'+icon+'</div>';
      html += '<div class="tl-content"><div class="tl-head"><span class="tl-author">'+escapeHtml(n.authorName||"Someone")+'</span>'+
        '<span class="tl-time">'+fmtRelative(n.createdAt)+'</span></div>';
      html += '<div class="tl-text">'+escapeHtml(n.text)+'</div></div></div>';
    });
    html += '</div></div>';

    html += '</div></div>';
    root.innerHTML = html;
    wireDrawer(lead.id);
    restoreFocus(focusInfo);
  }

  function wireDrawer(leadId){
    document.getElementById("closeDrawerBtn").addEventListener("click", closeDrawer);
    document.getElementById("drawerBackdrop").addEventListener("click", closeDrawer);
    document.getElementById("drawerCompanyName").addEventListener("input", function(){ drawerDraft.companyName = this.value; });
    document.getElementById("drawerCompanyName").addEventListener("blur", function(){
      var v = this.value.trim();
      if (v){ updateLeadFields(leadId, { companyName:v }); drawerDraft.companyName = v; this.value = v; }
      else {
        var current = state.leads.find(function(l){ return l.id === leadId; });
        var fallback = current ? current.companyName : "";
        drawerDraft.companyName = fallback; this.value = fallback;
      }
    });
    document.getElementById("drawerStage").addEventListener("change", function(){ changeStage(leadId, this.value); });
    document.getElementById("drawerOwner").addEventListener("change", function(){ updateLeadFields(leadId, { ownerId:this.value }); });
    var deleteBtn = document.getElementById("deleteLeadBtn");
    if (deleteBtn) deleteBtn.addEventListener("click", function(){
      if (confirm("Delete this lead? This can't be undone.")) deleteLead(leadId);
    });
    ["d_industry","d_website","d_source"].forEach(function(id, i){
      var field = ["industry","website","source"][i];
      var el = document.getElementById(id);
      el.addEventListener("input", function(){ drawerDraft[field] = this.value; });
      el.addEventListener("blur", function(){
        var f = {}; f[field] = this.value; updateLeadFields(leadId, f);
      });
    });
    document.getElementById("d_value").addEventListener("input", function(){ drawerDraft.value = this.value; });
    document.getElementById("d_value").addEventListener("blur", function(){
      var v = this.value === "" ? null : Number(this.value);
      updateLeadFields(leadId, { value:v });
    });

    document.getElementById("addContactToggle").addEventListener("click", function(){
      drawerDraft.contactFormOpen = !drawerDraft.contactFormOpen;
      renderDrawer();
    });
    document.getElementById("cancelContactBtn").addEventListener("click", function(){
      drawerDraft.contactFormOpen = false;
      drawerDraft.nc_name = ""; drawerDraft.nc_title = ""; drawerDraft.nc_email = ""; drawerDraft.nc_phone = "";
      renderDrawer();
    });
    ["nc_name","nc_title","nc_email","nc_phone"].forEach(function(id){
      document.getElementById(id).addEventListener("input", function(){ drawerDraft[id] = this.value; });
    });
    document.getElementById("saveContactBtn").addEventListener("click", function(){
      var name = document.getElementById("nc_name").value.trim();
      if (!name){ document.getElementById("nc_name").focus(); return; }
      addContact(leadId, {
        name:name,
        title:document.getElementById("nc_title").value,
        email:document.getElementById("nc_email").value,
        phone:document.getElementById("nc_phone").value
      });
      drawerDraft.contactFormOpen = false;
      drawerDraft.nc_name = ""; drawerDraft.nc_title = ""; drawerDraft.nc_email = ""; drawerDraft.nc_phone = "";
      renderDrawer();
    });
    document.querySelectorAll("[data-action='setPrimary']").forEach(function(btn){
      btn.addEventListener("click", function(){
        var item = btn.closest(".contact-item");
        setPrimaryContact(leadId, item.getAttribute("data-contact-id"));
      });
    });
    document.querySelectorAll("[data-action='deleteContact']").forEach(function(btn){
      btn.addEventListener("click", function(){
        var item = btn.closest(".contact-item");
        deleteContact(leadId, item.getAttribute("data-contact-id"));
      });
    });
    document.getElementById("noteText").addEventListener("input", function(){ drawerDraft.noteText = this.value; });
    document.getElementById("noteType").addEventListener("change", function(){ drawerDraft.noteType = this.value; });
    document.getElementById("logNoteBtn").addEventListener("click", function(){
      var text = document.getElementById("noteText").value;
      var type = document.getElementById("noteType").value;
      if (!text.trim()) return;
      addNote(leadId, type, text.trim());
      drawerDraft.noteText = "";
      renderDrawer();
    });
  }

  /* =================== Go =================== */
  boot();
})();
