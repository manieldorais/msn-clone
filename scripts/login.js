(function(){
  const host = '192.168.0.14';
  const url = 'ws://' + host + ':8087';
  let ws;
  const log = (m) => console.log('[WS]', m);

  function connect() {
    ws = new WebSocket(url);
    window.appWebSocket = ws;
    ws.addEventListener('open', () => { log('open'); });
    ws.addEventListener('message', ev => {
      let data;
      try { data = JSON.parse(ev.data); } catch (e) { log('raw:'+ev.data); return; }
      log('recv ' + ev.data);

      if (data.type === 'register') {
        if (data.status === 'ok') {
          alert('Cadastro realizado. Você será redirecionado para entrar.');
          // preenche email no login
          document.getElementById('email').value = data.user.email;
          // switch to login tab if needed
          document.getElementById('tabLogin').click();
        } else {
          alert('Erro no cadastro: ' + (data.message || 'erro'));
        }
      }

      if (data.type === 'login') {
        if (data.status === 'ok') {
          // salvar sessão simples em localStorage e redirecionar
          localStorage.setItem('msn_session', data.session || '');
          localStorage.setItem('msn_user', JSON.stringify(data.user || {}));
          window.location.href = 'home.html';
        } else {
          alert('Erro no login: ' + (data.message || 'credenciais inválidas'));
        }
      }

      if (data.type === 'system') {
        // opcional: mostrar
        log('system: ' + (data.message || ''));
      }
    });

    ws.addEventListener('close', () => { log('closed'); setTimeout(connect, 1500); });
    ws.addEventListener('error', (e) => { log('error'); });
  }

  // inicia conexão
  connect();

  // UI: tabs e formulários
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const cancelRegister = document.getElementById('cancelRegister');

  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active'); tabRegister.classList.remove('active');
    loginForm.classList.remove('hidden'); registerForm.classList.add('hidden');
    document.getElementById('email').focus();
  });
  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active'); tabLogin.classList.remove('active');
    registerForm.classList.remove('hidden'); loginForm.classList.add('hidden');
    document.getElementById('regName').focus();
  });

  // submit login -> ws message
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ws || ws.readyState !== WebSocket.OPEN) { alert('Conexão WS não pronta. Tente novamente.'); return; }
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    ws.send(JSON.stringify({type:'login', email, password}));
  });

  // submit register -> ws message
  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ws || ws.readyState !== WebSocket.OPEN) { alert('Conexão WS não pronta. Tente novamente.'); return; }
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const password2 = document.getElementById('regPassword2').value;
    const tos = document.getElementById('regTos').checked;
    if (!name || !email || !password) { alert('Preencha campos'); return; }
    if (password !== password2) { alert('Senhas não conferem'); return; }
    if (!tos) { alert('Aceite os termos'); return; }
    ws.send(JSON.stringify({type:'register', name, email, password}));
  });

  cancelRegister && cancelRegister.addEventListener('click', (e) => {
    e.preventDefault();
    tabLogin.click();
  });

  // toggle password buttons (se existirem)
  document.getElementById('togglePwd')?.addEventListener('click', (ev) => {
    const p = document.getElementById('password');
    p.type = p.type === 'text' ? 'password' : 'text';
    ev.target.textContent = p.type === 'text' ? 'Ocultar' : 'Mostrar';
  });
  document.getElementById('toggleRegPwd')?.addEventListener('click', (ev) => {
    const p = document.getElementById('regPassword');
    p.type = p.type === 'text' ? 'password' : 'text';
    ev.target.textContent = p.type === 'text' ? 'Ocultar' : 'Mostrar';
  });
})();