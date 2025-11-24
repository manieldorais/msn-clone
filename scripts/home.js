// Toggle sidebar on mobile + adicionar/aceitar convites
(function(){
	const btn = document.querySelector('.menu-toggle');
	const sidebar = document.getElementById('sidebar');
	btn && btn.addEventListener('click', () => {
		if (!sidebar) return;
		sidebar.classList.toggle('open');
		if (sidebar.classList.contains('open')) sidebar.scrollTop = 0;
	});
	
	document.addEventListener('click', (e) => {
		if (!sidebar) return;
		const withinSidebar = sidebar.contains(e.target);
		const withinBtn = btn.contains(e.target);
		if (window.innerWidth <= 600 && sidebar.classList.contains('open') && !withinSidebar && !withinBtn) {
			sidebar.classList.remove('open');
		}
	});
	
	// Adicionar contato (simulado)
	const openAdd = document.getElementById('openAdd');
	const addForm = document.getElementById('addForm');
	const newEmail = document.getElementById('newEmail');
	const sendRequest = document.getElementById('sendRequest');
	const cancelAdd = document.getElementById('cancelAdd');
	const invites = document.getElementById('invites');
	const otherContacts = document.getElementById('other-contacts');
	
	openAdd && openAdd.addEventListener('click', () => {
		addForm.hidden = !addForm.hidden;
		if (!addForm.hidden) newEmail.focus();
	});
	cancelAdd && cancelAdd.addEventListener('click', () => {
		addForm.hidden = true;
		newEmail.value = '';
	});
	
	sendRequest && sendRequest.addEventListener('click', () => {
  const email = (newEmail.value || '').trim();
  if (!email) { alert('Digite um e‑mail válido'); newEmail.focus(); return; }
  const socket = window.appWebSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) { alert('Sem conexão WS'); return; }
  socket.send(JSON.stringify({type:'add_friend', email, message: ''}));
  addForm.hidden = true;
  newEmail.value = '';
  setTimeout(() => { if (typeof requestFriendRequests === 'function') requestFriendRequests(); }, 400);
});
	
	// Delegação de eventos para aceitar/recusar/cancelar convites
	sidebar.addEventListener('click', (e) => {
		const acceptBtn = e.target.closest('.accept');
		const declineBtn = e.target.closest('.decline');
		const cancelReqBtn = e.target.closest('.cancel-request');

		const socket = window.appWebSocket;

		if (acceptBtn) {
			const reqId = parseInt(acceptBtn.dataset.requestId || 0, 10);
			if (!reqId) return;
			if (!socket || socket.readyState !== WebSocket.OPEN) { alert('Sem conexão WS'); return; }
			// enviar aceite ao servidor — servidor enviará updates (contacts + friend_requests) para ambos
			socket.send(JSON.stringify({ type: 'accept_friend', request_id: reqId }));
			// opcional: desabilitar botões até resposta
			acceptBtn.disabled = true;
			const node = acceptBtn.closest('.invite');
			node && node.classList.add('pending');
			return;
		}

		if (declineBtn) {
			const reqId = parseInt(declineBtn.dataset.requestId || 0, 10);
			if (!reqId) return;
			if (!socket || socket.readyState !== WebSocket.OPEN) { alert('Sem conexão WS'); return; }
			socket.send(JSON.stringify({ type: 'decline_friend', request_id: reqId }));
			declineBtn.disabled = true;
			const node = declineBtn.closest('.invite');
			node && node.classList.add('pending');
			return;
		}

		if (cancelReqBtn) {
			const reqId = parseInt(cancelReqBtn.dataset.requestId || 0, 10);
			if (!reqId) return;
			if (!socket || socket.readyState !== WebSocket.OPEN) { alert('Sem conexão WS'); return; }
			// reutiliza decline_friend para cancelar outgoing (server deve aceitar)
			socket.send(JSON.stringify({ type: 'decline_friend', request_id: reqId }));
			cancelReqBtn.disabled = true;
			const node = cancelReqBtn.closest('.invite');
			node && node.classList.add('pending');
			return;
		}
	});
})();

// Conversas (simulação)
(function(){
	const contacts = document.querySelectorAll('.contact');
	const welcome = document.querySelector('.welcome-panel');
	const convPanel = document.querySelector('.conversation-panel');
	const convTitle = document.getElementById('convTitle');
	const convBack = document.getElementById('convBack');
	const convInput = document.getElementById('convInput');
	const convSend = document.getElementById('convSend');
	
	function openConversation(contactEl){
		const name = contactEl.dataset.name || contactEl.textContent.trim();
		// marcar ativo na lista
		document.querySelectorAll('.contact').forEach(c => c.classList.toggle('active', c === contactEl));
		// atualizar header
		convTitle.textContent = name;
		// mostrar conversa / esconder welcome
		welcome && (welcome.style.display = 'none');
		convPanel.classList.remove('hidden');
		convPanel.setAttribute('aria-hidden','false');
		// foco no input
		convInput && convInput.focus();
	}
	
	function closeConversation(){
		document.querySelectorAll('.contact').forEach(c => c.classList.remove('active'));
		convPanel.classList.add('hidden');
		convPanel.setAttribute('aria-hidden','true');
		welcome && (welcome.style.display = '');
		// limpar conversa atual também no escopo global
		try { window.currentConversation = null; } catch(e){}
	}
    
    // enviar mensagem (via WebSocket -> servidor persiste e re‑envia)
	convSend && convSend.addEventListener('click', () => {
		const html = (convInput.value || '').trim(); // fallback plaintext when CKEditor not used
		const text = (function(h){ try { const tmp=document.createElement('div'); tmp.innerHTML = h; return tmp.textContent.trim(); } catch(e){ return (h||'').trim(); } })(html);
		if (!text || !window.currentConversation) return;
		const socket = window.appWebSocket;
		if (!socket || socket.readyState !== WebSocket.OPEN) { alert('Sem conexão WS'); return; }
		socket.send(JSON.stringify({ type: 'chat', conversation_id: window.currentConversation, text: text, html: html }));
		convInput.value = '';
	});
	
	// enviar com Enter
	convInput && convInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); convSend && convSend.click(); }
	});
	
	// inicial: mostrar welcome (já é padrão) — nada a fazer
})();

(function(){
    const host = '192.168.0.14';
    const WS_URL = 'ws://' + host + ':8087';
    let ws;
    let me = null;
    let currentConversation = null;
    // store the last contact info used to open a conversation so we can set title after server responds
    let pendingConversationContact = null;

    const contactsContainer = document.getElementById('other-contacts');
    const contactsEls = () => document.querySelectorAll('.contact');
    const welcome = document.querySelector('.welcome-panel');
    const convPanel = document.querySelector('.conversation-panel');
    const convTitle = document.getElementById('convTitle');
    const convBack = document.getElementById('convBack');
    const convInput = document.getElementById('convInput');
    const convSend = document.getElementById('convSend');
    const chatHistory = document.querySelector('.conversation-panel .chat-history');
    
    function log(msg){ console.log('[WS]', msg); }
    
    // renderização de mensagens (mover para dentro do mesmo escopo que chatHistory / me)
    function renderMessages(messages) {
        const container = chatHistory || document.querySelector('.conversation-panel .chat-history');
        if (!container) return;
        container.innerHTML = '';
        (messages || []).forEach(m => appendMessage(m));
        container.scrollTop = container.scrollHeight;
    }

    function appendMessage(m) {
        const container = chatHistory || document.querySelector('.conversation-panel .chat-history');
        if (!container) return;
        // tenta obter id do usuário autenticado
        let meId = null;
        try {
            meId = me ? parseInt(me.id, 10) : (JSON.parse(localStorage.getItem('msn_user') || '{}').id || null);
        } catch (e) { meId = null; }
        const div = document.createElement('div');
        div.className = 'message';
        const who = (m.sender_id && meId && parseInt(m.sender_id, 10) === meId)
            ? 'Você diz:'
            : (m.sender_name ? `${m.sender_name} diz:` : (m.sender_id ? ('ID ' + m.sender_id + ' diz:') : 'Sistema:'));
        const text = m.content || m.text || m.body || '';
        div.innerHTML = `<div class="msg-header">${escapeHtml(who)}</div><div class="msg-body">${text}</div>`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }
	
	// -- Notifications helpers ------------------------------------------------
	async function ensureNotificationPermission() {
		if (!('Notification' in window)) return false;
		if (Notification.permission === 'granted') return true;
		if (Notification.permission === 'denied') return false;
		try {
			const p = await Notification.requestPermission();
			return p === 'granted';
		} catch (e) { return false; }
	}
	
	function showNotification(title, body, data = {}) {
		if (!('Notification' in window)) return;
		if (Notification.permission !== 'granted') return;
		try {
			const opt = { body: body, tag: data.tag || undefined, data };
			const n = new Notification(title, opt);
			n.onclick = (ev) => {
				ev.preventDefault();
				try { window.focus(); } catch(e){}
				// if conversation id provided, try to open it
				if (data.conversation_id) openConversationById(data.conversation_id);
				else if (data.type === 'friend_request') {
					// focus sidebar and open invites
					document.getElementById('sidebar')?.scrollIntoView();
				}
				n.close();
			};
		} catch (e) {
			console.warn('Notification failed:', e);
		}
	}
	window.showNotification = showNotification; // exportar globalmente
	// -- Connection & message handling ---------------------------------------
	function connect() {
		ws = new WebSocket(WS_URL);
		window.appWebSocket = ws;
		
		ws.addEventListener('open', async () => {
			log('ws open');
			// ask for notification permission once connected
			await ensureNotificationPermission();
			// try authenticate with saved session
			const session = localStorage.getItem('msn_session');
			if (session) {
				ws.send(JSON.stringify({type:'auth', session}));
			} else {
				requestContacts();
				requestConversations();
				requestFriendRequests();
			}
		});
		
		ws.addEventListener('message', (ev) => {
			let data;
			try { data = JSON.parse(ev.data); } catch (e) { log('raw msg: '+ev.data); return; }
			handleMessage(data);
		});
		
		ws.addEventListener('close', () => { log('ws closed, reconnecting...'); setTimeout(connect, 1500); });
		ws.addEventListener('error', (e) => { log('ws error'); });
	}
	
	function handleMessage(data) {
        log('recv ' + JSON.stringify(data));

        // OPEN_CONVERSATION response (server created or returned a conversation id)
		if (data.type === 'wizz') { handleWizz(data.from || data.from_id); return; }
        if (data.type === 'open_conversation') {
            if (data.status === 'ok' && data.conversation_id) {
                currentConversation = parseInt(data.conversation_id, 10);
                // sincroniza com escopo global (outros IIFEs leem window.currentConversation)
                try { window.currentConversation = currentConversation; } catch(e){}
                // set title from pending contact if available
                if (pendingConversationContact) {
                    convTitle.textContent = pendingConversationContact.display_name || pendingConversationContact.email || ('ID ' + pendingConversationContact.id);
                    pendingConversationContact = null;
                } else {
                    convTitle.textContent = 'Conversa ' + currentConversation;
                }
                // request messages for this conversation
                requestMessages(currentConversation);
                return;
            } else {
                alert('Não foi possível abrir conversa: ' + (data.message || 'erro'));
                return;
            }
        }

        // mensagens da conversa (resposta a get_messages)
        if (data.type === 'messages' && data.status === 'ok') {
            if (!data.conversation_id) return;
            // se for a conversa atual, renderiza; senão ignora
            if (parseInt(data.conversation_id,10) === currentConversation) {
                renderMessages(data.messages || []);
            }
            return;
        }

        // auth/login
    if (data.type === 'auth' && data.status === 'ok') {
        me = data.user;
        updateHeader(me);
        // solicitar dados imediatamente após autenticar
        requestContacts();
        requestConversations();
        requestFriendRequests();
        return;
    }
    if (data.type === 'login' && data.status === 'ok') {
        me = data.user;
        localStorage.setItem('msn_user', JSON.stringify(me));
        updateHeader(me);
        requestContacts();
        requestConversations();
        requestFriendRequests();
        return;
    }

    // contatos (recebido do servidor)
    if (data.type === 'contacts' && data.status === 'ok') {
        renderContacts(data.contacts || []);
        return;
    }

    // convites pendentes (incoming/outgoing)
    if (data.type === 'friend_requests' && data.status === 'ok') {
        renderInvites(data.incoming || [], data.outgoing || []);
        return;
    }

    // notificações de novo convite (push breve)
    if (data.type === 'friend_request') {
        showNotification('Novo convite', `Convite de ${data.from_email || data.from}`);
        // pedir a lista completa para garantir sincronia
        setTimeout(() => { if (typeof requestFriendRequests === 'function') requestFriendRequests(); }, 200);
        return;
    }

    // aceitação de convite
    if (data.type === 'accept_friend' && data.status === 'ok') {
        setTimeout(() => { if (typeof requestContacts === 'function') requestContacts(); if (typeof requestFriendRequests === 'function') requestFriendRequests(); }, 200);
        return;
    }
    if (data.type === 'friend_accepted') {
        showNotification('Convite aceito', `Usuário ${data.by} aceitou seu convite`);
        setTimeout(() => { if (typeof requestContacts === 'function') requestContacts(); }, 200);
        return;
    }

    // mensagens / chat
    if (data.type === 'chat' && data.conversation_id) {
        const convId = parseInt(data.conversation_id);
        const msg = data.message;
        if (currentConversation === convId) {
            appendMessage(msg);
        } else {
            const el = document.querySelector(`.contact[data-conv="${convId}"], .contact[data-id="${convId}"]`);
            if (el) el.classList.add('has-unread');
            showNotification('Nova mensagem', `${msg.sender_id === (me && me.id) ? 'Você' : 'Mensagem'}: ${msg.content}`, { type:'chat', conversation_id: convId, tag: 'chat-' + convId });
        }
        return;
    }

    // status/update genérico
    if (data.type === 'update_status') {
        if (data.status === 'ok') {
            document.getElementById('userStatus').textContent = data.status_message || '— sem status —';
        }
        return;
    }

    // presença (atualização de contato)
if (data.type === 'presence_update') {
    // update single contact dot
    const userId = String(data.user_id || data.userId);
    const el = document.querySelector(`.contact[data-id="${userId}"]`);
    if (el) {
        const dot = el.querySelector('.status-dot');
        if (dot) dot.style.background = (data.online ? '#4caf50' : '#b3b3b3');
        // optional: show last_seen tooltip when offline
        if (!data.online && data.last_seen) el.title = 'Visto em: ' + data.last_seen;
    } else {
        // se não existe, pode requisitar lista de contatos para sincronizar
        if (typeof requestContacts === 'function') requestContacts();
    }
    return;
}

// outros tipos deixados para handlers existentes
    log('Unhandled WS message type: ' + (data.type || 'unknown'));
}
	
	function requestContacts() {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify({type:'get_contacts'}));
	}
	function requestConversations() {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify({type:'get_conversations'}));
	}
	function requestMessages(conversationId) {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify({type:'get_messages', conversation_id: conversationId}));
	}
	function requestFriendRequests() {
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify({type:'get_friend_requests'}));
	}
	
	// -- Rendering ------------------------------------------------------------
	function renderContacts(list) {
        const other = document.getElementById('other-contacts');
        if (!other) return;
        other.innerHTML = '';
        (list || []).forEach(c => {
            const div = document.createElement('div');
            div.className = 'contact';
            div.dataset.id = c.id;
            div.dataset.email = c.email || '';
            div.tabIndex = 0;
            // presence: c.presence == 1 -> online
            const dotColor = (c.presence && parseInt(c.presence,10)===1) ? '#4caf50' : '#b3b3b3';
            div.innerHTML = `<div class="status-dot" style="width:10px;height:10px;border-radius:50%;background:${dotColor};margin-right:8px;flex:0 0 10px"></div><span>${escapeHtml(c.display_name || c.email || ('ID ' + c.id))}</span>`;
            other.appendChild(div);
        });
    }
	
	function renderInvites(incoming, outgoing) {
		const invitesEl = document.getElementById('invites');
		invitesEl.innerHTML = '';
		if (!incoming.length && !outgoing.length) {
			invitesEl.innerHTML = '<div style="padding:8px;color:#666">Nenhum convite pendente</div>';
			return;
		}
		incoming.forEach(fr => {
			const d = document.createElement('div');
			d.className = 'invite';
			d.innerHTML = `<div><strong>${escapeHtml(fr.from_email)}</strong><div style="font-size:12px;color:#666">${escapeHtml(fr.message||'')}</div></div>
			<div class="invite-actions">
			<button class="accept" data-request-id="${fr.id}" type="button">Aceitar</button>
			<button class="decline" data-request-id="${fr.id}" type="button">Recusar</button>
			</div>`;
			invitesEl.appendChild(d);
		});
		outgoing.forEach(fr => {
			const d = document.createElement('div');
			d.className = 'invite';
			d.innerHTML = `<div><strong>${escapeHtml(fr.to_email)}</strong> <small style="color:#6b6b6b">(Solicitação enviada)</small></div>
        <div class="invite-actions"><button class="cancel-request" data-request-id="${fr.id}" type="button">Cancelar</button></div>`;
			invitesEl.appendChild(d);
		});
	}
	
	function renderConversations(list) {
		// not fully implemented UI for conversation list; could map conv -> contact elements if server returns participants
	}
	
	function openConversationForContact(contact) {
		// guard rails
        pendingConversationContact = contact;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            alert('Sem conexão WS');
            return;
        }
        // request server to open/create private conversation and return id
        ws.send(JSON.stringify({type:'open_conversation', with_user_id: contact.id}));
        // visual: mark active contact
        document.querySelectorAll('.contact').forEach(c => c.classList.toggle('active', c.dataset.id == contact.id));
        // prepare UI (hide welcome, show panel) but clear history until messages arrive
        convTitle.textContent = contact.display_name || contact.email || ('ID ' + contact.id);
        welcome && (welcome.style.display = 'none');
        convPanel.classList.remove('hidden');
        convPanel.setAttribute('aria-hidden','false');
        // clear previous history while loading
        chatHistory && (chatHistory.innerHTML = '<div style="padding:12px;color:#666">Carregando mensagens…</div>');
	}
	// update header UI with current user info
	function updateHeader(user) {
		if (!user) return;
		const nameEl = document.getElementById('userName');
		const emailEl = document.getElementById('userEmail');
		const statusEl = document.getElementById('userStatus');
		if (nameEl) nameEl.textContent = user.name || user.display_name || 'Usuário';
		if (emailEl) emailEl.textContent = user.email ? `<${user.email}>` : '<sem email>';
		if (statusEl) statusEl.textContent = user.status_message || user.status || '— sem status —';
	}
	
	// edit status button handler
	document.getElementById('editStatusBtn')?.addEventListener('click', async () => {
    const cur = document.getElementById('userStatus')?.textContent || '';
    const nv = prompt('Defina seu status', cur === '— sem status —' ? '' : cur);
    if (nv === null) return;
    document.getElementById('userStatus').textContent = nv || '— sem status —';
    // persist via WS (server pode implementar)
    const socket = window.appWebSocket;
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'update_status', status: nv }));
    }
});
	
	// load saved user info if available (fast UI before auth)
	const saved = localStorage.getItem('msn_user');
	if (saved) {
    try { updateHeader(JSON.parse(saved)); } catch(e){}
	}

// exportar funções para uso por outros IIFEs/handlers (delegação)
window.openConversationForContact = openConversationForContact;
window.requestContacts = requestContacts;
window.requestFriendRequests = requestFriendRequests;

// start websocket connection
if (typeof connect === 'function') connect();
})();

// helper disponível globalmente para todo o arquivo
function escapeHtml(s){
    return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// depois de declarar renderContacts e openConversationForContact, adicione delegation
(function attachContactDelegation(){
    const other = document.getElementById('other-contacts');
    const fav = document.getElementById('favorites');
    function onClick(e){
        const el = e.target.closest('.contact');
        if (!el) return;
        // reconstruir objeto mínimo esperado por openConversationForContact
        const contact = { id: parseInt(el.dataset.id || 0, 10), display_name: el.dataset.name || el.textContent.trim(), email: el.dataset.email || null };
        openConversationForContact(contact);
    }
    other && other.addEventListener('click', onClick);
    fav && fav.addEventListener('click', onClick);
})();

(function(){
    const convEditorEl = document.getElementById('convEditor');
    const convInput = document.getElementById('convInput'); // fallback
    const convSend = document.getElementById('convSend');
    const wizzBtn = document.getElementById('wizzBtn');
    let convEditorInstance = null;

    // init CKEditor (Classic) if disponível
    if (window.ClassicEditor && convEditorEl) {
        ClassicEditor.create(convEditorEl, {
            toolbar: ['bold','italic','link','bulletedList','numberedList','undo','redo','heading'],
        }).then(editor => {
            convEditorInstance = editor;
        }).catch(err => { console.warn('CKEditor init failed', err); });
    }

    // --- EMOJI PICKER ------------------------------------------------
    const emojiBtn = document.querySelector('.tool-btn[title="Emoticons"]');
    const emojiList = ['😀','😃','😄','😁','😆','😂','🤣','😊','😍','😘','😜','🤔','😎','😭','😡','👍','👎','🙏','🎉','🔥','💯','😴','🤖','🎧','🎵'];
    let emojiPanel = null;

    function createEmojiPanel(){
        if (emojiPanel) return;
        emojiPanel = document.createElement('div');
        emojiPanel.className = 'emoji-panel';
        emojiPanel.setAttribute('role','dialog');
        emojiPanel.style.position = 'absolute';
        emojiPanel.style.zIndex = 9999;
        emojiPanel.style.padding = '8px';
        emojiPanel.style.border = '1px solid #ddd';
        emojiPanel.style.background = '#fff';
        emojiPanel.style.boxShadow = '0 4px 10px rgba(0,0,0,0.08)';
        emojiPanel.style.borderRadius = '6px';
        emojiPanel.style.display = 'grid';
        emojiPanel.style.gridTemplateColumns = 'repeat(8, 28px)';
        emojiPanel.style.gap = '6px';
        emojiPanel.style.width = 'auto';
        emojiPanel.style.maxWidth = '320px';
        emojiPanel.style.padding = '10px';

        emojiList.forEach(e => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'emoji-btn';
            btn.style.fontSize = '18px';
            btn.style.width = '28px';
            btn.style.height = '28px';
            btn.style.border = 'none';
            btn.style.background = 'transparent';
            btn.style.cursor = 'pointer';
            btn.textContent = e;
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                insertEmoji(e);
                hideEmojiPanel();
            });
            emojiPanel.appendChild(btn);
        });

        document.body.appendChild(emojiPanel);

        // close on outside click
        document.addEventListener('click', (ev) => {
            if (!emojiPanel) return;
            if (ev.target === emojiBtn || emojiBtn.contains(ev.target)) return;
            if (!emojiPanel.contains(ev.target)) hideEmojiPanel();
        });
    }

    function showEmojiPanel(){
        createEmojiPanel();
        const rect = emojiBtn.getBoundingClientRect();
        emojiPanel.style.top = (window.scrollY + rect.bottom + 6) + 'px';
        emojiPanel.style.left = Math.max(8, (window.scrollX + rect.left)) + 'px';
        emojiPanel.style.display = 'grid';
    }

    function hideEmojiPanel(){
        if (!emojiPanel) return;
        emojiPanel.style.display = 'none';
    }

    function insertEmoji(e){
        // if editor available, insert as HTML fragment
        if (convEditorInstance) {
            try {
                const viewFragment = convEditorInstance.data.processor.toView(e);
                const modelFragment = convEditorInstance.data.toModel(viewFragment);
                convEditorInstance.model.change( writer => {
                    convEditorInstance.model.insertContent(modelFragment, convEditorInstance.model.document.selection);
                });
                convEditorInstance.editing.view.focus();
                return;
            } catch (err){ console.warn('Emoji insert to CKEditor failed', err); }
        }
        // fallback: insert at textarea caret or append
        if (convInput) {
            const start = convInput.selectionStart || convInput.value.length;
            const val = convInput.value || '';
            convInput.value = val.slice(0,start) + e + val.slice(start);
            convInput.focus();
            convInput.selectionStart = convInput.selectionEnd = start + e.length;
        }
    }

    if (emojiBtn) {
        emojiBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            createEmojiPanel();
            // toggle
            if (emojiPanel && emojiPanel.style.display !== 'none') {
                if (emojiPanel.style.display === 'grid') { hideEmojiPanel(); return; }
            }
            showEmojiPanel();
        });
    }
    // --- end emoji picker ---------------------------------------------

    // enviar mensagem (usa HTML do editor quando disponível)
    convSend && convSend.addEventListener('click', () => {
        const socket = window.appWebSocket;
        if (!socket || socket.readyState !== WebSocket.OPEN) { alert('Sem conexão WS'); return; }
        const html = convEditorInstance ? convEditorInstance.getData() : (convInput.value || '').trim();
        const text = (function(h){ try { const tmp=document.createElement('div'); tmp.innerHTML = h; return tmp.textContent.trim(); } catch(e){ return (h||'').trim(); } })(html);
        if (!text || !window.currentConversation) return;
        socket.send(JSON.stringify({ type: 'chat', conversation_id: window.currentConversation, text: text, html: html }));
        if (convEditorInstance) convEditorInstance.setData('');
        else convInput.value = '';
    });

    // Enter para enviar (mantém shift+Enter para quebra)
    if (convEditorEl) {
        convEditorEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); convSend.click(); }
        });
    }

    // "Chamar Atenção" (wizz) — envia evento ao servidor; servidor deve retransmitir
    wizzBtn && wizzBtn.addEventListener('click', () => {
        const socket = window.appWebSocket;
        if (!socket || socket.readyState !== WebSocket.OPEN) { alert('Sem conexão WS'); return; }
        if (!window.currentConversation) { alert('Abra uma conversa primeiro'); return; }
        socket.send(JSON.stringify({ type: 'wizz', conversation_id: window.currentConversation }));
    });

    // tratar wizz recebido (pequena animação + notificação)
    function handleWizz(fromUserId) {
        const panel = document.querySelector('.conversation-panel');
        if (!panel) return;
        panel.classList.remove('conv-wizz');
        void panel.offsetWidth; // restart animation
        panel.classList.add('conv-wizz');
        // optional sound (coloque sounds/wizz.mp3 no servidor)
        try {
            if (typeof Audio !== 'undefined') {
                const a = new Audio('sounds/wizz.mp3');
                a.play().catch(()=>{});
            }
        } catch(e){}
        showNotification('Chamar atenção', `Usuário ${fromUserId} te chamou a atenção`);
    }
	window.handleWizz = handleWizz;
    // integracao no handleMessage (certifique-se de chamar handleWizz quando ws enviar {type:'wizz'})
    // exemplo: inside handleMessage():
    //if (data.type === 'wizz') { handleWizz(data.from || data.from_id); return; }

    // IMPORTANT: servidor deve sanitizar html antes de salvar/exibir para evitar XSS.
})();
