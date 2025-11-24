<?php
// Mostrar erros (suprimir deprecations)
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
date_default_timezone_set('UTC');

function logmsg($msg) {
    $line = '[' . date('Y-m-d H:i:s') . '] ' . $msg . PHP_EOL;
    echo $line;
    @file_put_contents(__DIR__ . '/websocket.log', $line, FILE_APPEND);
}

logmsg('Bootstrap start: PHP ' . PHP_VERSION);

// Autoload
$autoload = __DIR__ . '/vendor/autoload.php';
if (!file_exists($autoload)) {
    logmsg('ERROR: vendor/autoload.php not found. Execute "composer install" in ' . __DIR__);
    exit(1);
}
require $autoload;

use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;
use Ratchet\WebSocket\WsServer;
use Ratchet\Http\HttpServer;
use Ratchet\Server\IoServer;

$db_dsn  = 'mysql:host=127.0.0.1;dbname=msn;charset=utf8mb4';
$db_user = 'root';
$db_pass = '';

try {
    $pdo = new PDO($db_dsn, $db_user, $db_pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    logmsg('DB connected');
} catch (Throwable $e) {
    logmsg('DB connection failed: ' . $e->getMessage());
    exit(1);
}

class Chat implements MessageComponentInterface {
    protected $clients;
    protected $pdo;
    // map userId => ConnectionInterface
    protected $userConnections = [];

    public function __construct(PDO $pdo) {
        $this->clients = new \SplObjectStorage;
        $this->pdo = $pdo;
        logmsg("Chat server constructed");
    }

    public function onOpen(ConnectionInterface $conn) {
        $this->clients->attach($conn);
        $conn->userId = null;
        logmsg("New connection ({$conn->resourceId})");
        try {
            $conn->send(json_encode(['type'=>'system','message'=>'Bem-vindo ao servidor WS','id'=>$conn->resourceId]));
            logmsg("Welcome sent to {$conn->resourceId}");
        } catch (\Throwable $e) {
            logmsg("ERROR sending welcome to {$conn->resourceId}: " . $e->getMessage());
        }
    }

    public function onMessage(ConnectionInterface $from, $msg) {
        logmsg(sprintf("Received %d bytes from %d", strlen($msg), $from->resourceId));
        $decoded = json_decode($msg, true);
        if (!is_array($decoded)) {
            $from->send(json_encode(['type'=>'ack','message'=>'Recebido texto cru']));
            return;
        }

        $action = $decoded['type'] ?? null;

        // REGISTER (already present in earlier code)
        if ($action === 'register') {
            $name = trim($decoded['name'] ?? '');
            $email = trim($decoded['email'] ?? '');
            $password = $decoded['password'] ?? '';
            if (!$email || !$password || !$name) {
                $from->send(json_encode(['type'=>'register','status'=>'error','message'=>'Preencha nome, e‑mail e senha']));
                return;
            }
            try {
                $stmt = $this->pdo->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
                $stmt->execute([$email]);
                if ($stmt->fetch()) {
                    $from->send(json_encode(['type'=>'register','status'=>'error','message'=>'E‑mail já cadastrado']));
                    return;
                }
                $hash = password_hash($password, PASSWORD_BCRYPT);
                $ins = $this->pdo->prepare('INSERT INTO users (email, display_name, password_hash, presence, created_at) VALUES (?, ?, ?, ?, NOW())');
                $ins->execute([$email, $name, $hash, 'online']);
                $userId = (int)$this->pdo->lastInsertId();
                logmsg("User registered: {$userId} ({$email})");
                $from->send(json_encode(['type'=>'register','status'=>'ok','user'=>['id'=>$userId,'email'=>$email,'name'=>$name]]));
            } catch (\Throwable $e) {
                logmsg('Register error: ' . $e->getMessage());
                $from->send(json_encode(['type'=>'register','status'=>'error','message'=>'Erro ao cadastrar']));
            }
            return;
        }

        // LOGIN
        if ($action === 'login') {
            $email = trim($decoded['email'] ?? '');
            $password = $decoded['password'] ?? '';
            if (!$email || !$password) {
                $from->send(json_encode(['type'=>'login','status'=>'error','message'=>'Preencha e‑mail e senha']));
                return;
            }
            try {
                $stmt = $this->pdo->prepare('SELECT id, display_name, password_hash FROM users WHERE email = ? LIMIT 1');
                $stmt->execute([$email]);
                $user = $stmt->fetch();
                if (!$user || !password_verify($password, $user['password_hash'])) {
                    $from->send(json_encode(['type'=>'login','status'=>'error','message'=>'Credenciais inválidas']));
                    return;
                }
                $token = bin2hex(random_bytes(24));
                $this->pdo->prepare('INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)')->execute([$token, $user['id']]);
                $this->pdo->prepare('UPDATE users SET presence = ?, last_seen = NOW() WHERE id = ?')->execute(['online', $user['id']]);
                $from->userId = (int)$user['id'];
                $this->userConnections[$from->userId] = $from;
                logmsg("User logged in: {$from->userId} (conn {$from->resourceId})");
                $from->send(json_encode(['type'=>'login','status'=>'ok','user'=>['id'=>$user['id'],'name'=>$user['display_name'],'email'=>$email],'session'=>$token]));
            } catch (\Throwable $e) {
                logmsg('Login error: ' . $e->getMessage());
                $from->send(json_encode(['type'=>'login','status'=>'error','message'=>'Erro ao efetuar login']));
            }
            return;
        }

        // AUTH BY SESSION TOKEN (optionally used by home on open)
        if ($action === 'auth') {
            $token = $decoded['session'] ?? '';
            if (!$token) { $from->send(json_encode(['type'=>'auth','status'=>'error','message'=>'token ausente'])); return; }
            try {
                $stmt = $this->pdo->prepare('SELECT s.user_id,u.display_name,u.email,u.status_message FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? LIMIT 1');
                $stmt->execute([$token]);
                $row = $stmt->fetch();
                if (!$row) { $from->send(json_encode(['type'=>'auth','status'=>'error','message'=>'sessão inválida'])); return; }
                $from->userId = (int)$row['user_id'];
                $this->userConnections[$from->userId] = $from;

                $from->send(json_encode([
                    'type'=>'auth',
                    'status'=>'ok',
                    'user'=>[
                        'id' => $row['user_id'],
                        'name' => $row['display_name'],
                        'email' => $row['email'],
                        'status_message' => $row['status_message']
                    ]
                ]));

                // envia dados essenciais ao cliente automaticamente
                $this->sendFriendRequestsToUser($from, $from->userId);
                $this->sendContactsToUser($from, $from->userId);
            } catch (\Throwable $e) {
                logmsg('Auth error: '.$e->getMessage());
                $from->send(json_encode(['type'=>'auth','status'=>'error','message'=>'erro interno']));
            }
            return;
        }

        // GET CONTACTS
        if ($action === 'get_contacts') {
            $uid = $from->userId;
            if (!$uid) { $from->send(json_encode(['type'=>'contacts','status'=>'error','message'=>'não autenticado'])); return; }
            try {
                // inclui group_name (p.ex. 'favorites') para separar no cliente
                $stmt = $this->pdo->prepare('SELECT c.contact_id AS id, u.display_name, u.email, u.presence, COALESCE(c.group_name,"") AS group_name FROM contacts c JOIN users u ON c.contact_id = u.id WHERE c.user_id = ? ORDER BY u.display_name');
                $stmt->execute([$uid]);
                $contacts = $stmt->fetchAll();
                $from->send(json_encode(['type'=>'contacts','status'=>'ok','contacts'=>$contacts]));
            } catch (\Throwable $e) {
                logmsg('Get contacts error: '.$e->getMessage());
                $from->send(json_encode(['type'=>'contacts','status'=>'error','message'=>'erro ao obter contatos']));
            }
            return;
        }

        // GET FRIEND REQUESTS (incoming + outgoing)
        if ($action === 'get_friend_requests') {
            $uid = $from->userId;
            if (!$uid) { $from->send(json_encode(['type'=>'friend_requests','status'=>'error','message'=>'não autenticado'])); return; }
            try {
                // incoming
                $stmt = $this->pdo->prepare('SELECT fr.id, fr.from_user_id, u.display_name AS from_name, u.email AS from_email, fr.message, fr.status, fr.created_at FROM friend_requests fr JOIN users u ON fr.from_user_id = u.id WHERE fr.to_user_id = ? AND fr.status = "pending" ORDER BY fr.created_at DESC');
                $stmt->execute([$uid]);
                $incoming = $stmt->fetchAll();
                // outgoing
                $stmt = $this->pdo->prepare('SELECT fr.id, fr.to_user_id, u.display_name AS to_name, u.email AS to_email, fr.message, fr.status, fr.created_at FROM friend_requests fr JOIN users u ON fr.to_user_id = u.id WHERE fr.from_user_id = ? AND fr.status = "pending" ORDER BY fr.created_at DESC');
                $stmt->execute([$uid]);
                $outgoing = $stmt->fetchAll();
                $from->send(json_encode(['type'=>'friend_requests','status'=>'ok','incoming'=>$incoming,'outgoing'=>$outgoing]));
            } catch (\Throwable $e) {
                logmsg('Get friend requests error: '.$e->getMessage());
                $from->send(json_encode(['type'=>'friend_requests','status'=>'error','message'=>'erro ao obter convites']));
            }
            return;
        }

        // DECLINE FRIEND
        if ($action === 'decline_friend') {
            $uid = $from->userId;
            $reqId = (int)($decoded['request_id'] ?? 0);
            if (!$uid || !$reqId) { $from->send(json_encode(['type'=>'decline_friend','status'=>'error','message'=>'parâmetros inválidos'])); return; }
            try {
                $stmt = $this->pdo->prepare('SELECT from_user_id,to_user_id FROM friend_requests WHERE id = ? LIMIT 1');
                $stmt->execute([$reqId]);
                $r = $stmt->fetch();
                if (!$r) { $from->send(json_encode(['type'=>'decline_friend','status'=>'error','message'=>'solicitação não encontrada'])); return; }
                if ($r['to_user_id'] != $uid) { $from->send(json_encode(['type'=>'decline_friend','status'=>'error','message'=>'não autorizado'])); return; }
                $this->pdo->prepare('UPDATE friend_requests SET status = ?, responded_at = NOW() WHERE id = ?')->execute(['declined', $reqId]);
                $from->send(json_encode(['type'=>'decline_friend','status'=>'ok','request_id'=>$reqId]));
                // notify requester if online
                if (isset($this->userConnections[$r['from_user_id']])) {
                    $this->userConnections[$r['from_user_id']]->send(json_encode(['type'=>'friend_declined','by'=>$uid]));
                }
            } catch (\Throwable $e) {
                logmsg('Decline friend error: '.$e->getMessage());
                $from->send(json_encode(['type'=>'decline_friend','status'=>'error','message'=>'erro ao recusar']));
            }
            return;
        }

        // GET CONVERSATIONS
        if ($action === 'get_conversations') {
            $uid = $from->userId;
            if (!$uid) { $from->send(json_encode(['type'=>'conversations','status'=>'error','message'=>'não autenticado'])); return; }
            try {
                $stmt = $this->pdo->prepare('
                    SELECT conv.id, conv.type, conv.title, m.content AS last_message, m.created_at AS last_at
                    FROM conversations conv
                    LEFT JOIN messages m ON conv.last_message_id = m.id
                    JOIN conversation_participants p ON p.conversation_id = conv.id
                    WHERE p.user_id = ?
                    ORDER BY m.created_at DESC
                ');
                $stmt->execute([$uid]);
                $convs = $stmt->fetchAll();
                $from->send(json_encode(['type'=>'conversations','status'=>'ok','conversations'=>$convs]));
            } catch (\Throwable $e) {
                logmsg('Get conversations error: '.$e->getMessage());
                $from->send(json_encode(['type'=>'conversations','status'=>'error','message'=>'erro ao obter conversas']));
            }
            return;
        }

        // GET MESSAGES (historico de uma conversa)
        if ($action === 'get_messages') {
            $convId = (int)($decoded['conversation_id'] ?? 0);
            $uid = $from->userId;
            if (!$convId || !$uid) { $from->send(json_encode(['type'=>'messages','status'=>'error','message'=>'parâmetros inválidos'])); return; }
            try {
                $stmt = $this->pdo->prepare('SELECT m.id,m.conversation_id,m.sender_id,m.content,m.created_at,u.display_name AS sender_name FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = ? ORDER BY m.created_at ASC LIMIT 100');
                $stmt->execute([$convId]);
                $msgs = $stmt->fetchAll();
                $from->send(json_encode(['type'=>'messages','status'=>'ok','conversation_id'=>$convId,'messages'=>$msgs]));
            } catch (\Throwable $e) {
                logmsg('Get messages error: '.$e->getMessage());
                $from->send(json_encode(['type'=>'messages','status'=>'error','message'=>'erro ao obter mensagens']));
            }
            return;
        }

        // CHAT SEND (recebe do cliente, persiste e retransmite aos participantes)
        if ($action === 'chat') {
            $uid = $from->userId;
            $convId = (int)($decoded['conversation_id'] ?? 0);
            $text = trim($decoded['text'] ?? '');
            if (!$uid || !$convId || $text === '') { $from->send(json_encode(['type'=>'chat','status'=>'error','message'=>'parâmetros inválidos'])); return; }
            try {
                // insere mensagem
                $ins = $this->pdo->prepare('INSERT INTO messages (conversation_id,sender_id,content,created_at) VALUES (?, ?, ?, NOW())');
                $ins->execute([$convId, $uid, $text]);
                $msgId = (int)$this->pdo->lastInsertId();
                // compor objeto de mensagem consistente
                $msgRow = [
                    'id' => $msgId,
                    'conversation_id' => $convId,
                    'sender_id' => $uid,
                    'sender_name' => $this->getUserDisplayNameById($uid) ?? null,
                    'content' => $text,
                    'created_at' => date('Y-m-d H:i:s')
                ];
                // obter participantes da conversa
                $stmt = $this->pdo->prepare('SELECT user_id FROM conversation_participants WHERE conversation_id = ?');
                $stmt->execute([$convId]);
                $parts = $stmt->fetchAll(\PDO::FETCH_COLUMN);
                // enviar mensagem para cada participante online
                foreach ($parts as $pId) {
                    if (isset($this->userConnections[$pId])) {
                        $this->userConnections[$pId]->send(json_encode(['type'=>'chat','conversation_id'=>$convId,'message'=>$msgRow]));
                    }
                }
                // confirmação ao remetente (caso queira)
                $from->send(json_encode(['type'=>'chat_sent','status'=>'ok','message_id'=>$msgId,'conversation_id'=>$convId]));
            } catch (\Throwable $e) {
                logmsg('Chat send error: '.$e->getMessage());
                $from->send(json_encode(['type'=>'chat','status'=>'error','message'=>'erro ao enviar mensagem']));
            }
            return;
        }

        // OPEN / CREATE PRIVATE CONVERSATION between authenticated user and another user
        if ($action === 'open_conversation') {
            $uid = $from->userId;
            $other = isset($decoded['with_user_id']) ? (int)$decoded['with_user_id'] : 0;
            if (!$uid || !$other) {
                $from->send(json_encode(['type'=>'open_conversation','status'=>'error','message'=>'parâmetros inválidos']));
                return;
            }
            try {
                // procura conversa privada que tenha os dois participantes
                $stmt = $this->pdo->prepare('
                    SELECT conv.id FROM conversations conv
                    JOIN conversation_participants p1 ON p1.conversation_id = conv.id
                    JOIN conversation_participants p2 ON p2.conversation_id = conv.id
                    WHERE conv.type = "private" AND p1.user_id = ? AND p2.user_id = ?
                    LIMIT 1
                ');
                $stmt->execute([$uid, $other]);
                $row = $stmt->fetch();
                if ($row) {
                    $convId = (int)$row['id'];
                } else {
                    // cria nova conversa privada e adiciona participantes
                    $this->pdo->prepare('INSERT INTO conversations (type, title, created_by, created_at) VALUES (?, NULL, ?, NOW())')
                        ->execute(['private', $uid]);
                    $convId = (int)$this->pdo->lastInsertId();
                    $this->pdo->prepare('INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, NOW()), (?, ?, NOW())')
                        ->execute([$convId, $uid, $convId, $other]);
                }
                $from->send(json_encode(['type'=>'open_conversation','status'=>'ok','conversation_id'=>$convId]));
            } catch (\Throwable $e) {
                logmsg('Open conversation error: '.$e->getMessage());
                $from->send(json_encode(['type'=>'open_conversation','status'=>'error','message'=>'erro ao abrir conversa']));
            }
            return;
        }
        // UPDATE STATUS (persistir status_message e notificar contatos)
        if ($action === 'update_status') {
            $uid = $from->userId;
            $status = trim($decoded['status'] ?? '');
            if (!$uid) { $from->send(json_encode(['type'=>'update_status','status'=>'error','message'=>'não autenticado'])); return; }
            try {
                $this->pdo->prepare('UPDATE users SET status_message = ? WHERE id = ?')->execute([$status ?: null, $uid]);
                // resposta imediata ao cliente
                $from->send(json_encode(['type'=>'update_status','status'=>'ok','status_message'=>$status]));
                // notificar contatos online para atualizar presença/status
                $stmt = $this->pdo->prepare('SELECT contact_id FROM contacts WHERE user_id = ?');
                $stmt->execute([$uid]);
                $contacts = $stmt->fetchAll(\PDO::FETCH_COLUMN);
                foreach ($contacts as $cId) {
                    if (isset($this->userConnections[$cId])) {
                        $this->userConnections[$cId]->send(json_encode(['type'=>'presence_update','user_id'=>$uid,'status_message'=>$status]));
                    }
                }
                // também envie contatos atualizados ao próprio usuário (opcional)
                $this->sendContactsToUser($from, $uid);
            } catch (\Throwable $e) {
                logmsg('Update status error: '.$e->getMessage());
                $from->send(json_encode(['type'=>'update_status','status'=>'error','message'=>'erro ao salvar status']));
            }
            return;
        }
        // FRIEND REQUEST (send)
        if ($action === 'add_friend') {
            $uid = $from->userId;
            $email = trim($decoded['email'] ?? '');
            $message = trim($decoded['message'] ?? '');
            if (!$uid || !$email) {
                $from->send(json_encode(['type'=>'add_friend','status'=>'error','message'=>'parâmetros inválidos']));
                return;
            }
            if ($email === $this->getUserEmailById($uid)) {
                $from->send(json_encode(['type'=>'add_friend','status'=>'error','message'=>'Não é possível enviar convite para si mesmo']));
                return;
            }
            try {
                $stmt = $this->pdo->prepare('SELECT id, display_name, email FROM users WHERE email = ? LIMIT 1');
                $stmt->execute([$email]);
                $toUser = $stmt->fetch();
                if (!$toUser) {
                    $from->send(json_encode(['type'=>'add_friend','status'=>'error','message'=>'usuário não encontrado']));
                    return;
                }
                // evita duplicatas pendentes
                $check = $this->pdo->prepare('SELECT id,status FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? LIMIT 1');
                $check->execute([$uid, $toUser['id']]);
                $exists = $check->fetch();
                if ($exists && $exists['status'] === 'pending') {
                    $from->send(json_encode(['type'=>'add_friend','status'=>'error','message'=>'Convite já enviado']));
                    return;
                }
                // inserir request
                $ins = $this->pdo->prepare('INSERT INTO friend_requests (from_user_id,to_user_id,message,status,created_at) VALUES (?, ?, ?, "pending", NOW())');
                $ins->execute([$uid, $toUser['id'], $message]);
                $reqId = (int)$this->pdo->lastInsertId();
                logmsg("Friend request {$reqId} from {$uid} to {$toUser['id']}");
                // enviar lista atualizada ao remetente
                $this->sendFriendRequestsToUser($from, $uid);
                // notificar destinatário e enviar lista para ele se online
                if (isset($this->userConnections[$toUser['id']])) {
                    $targetConn = $this->userConnections[$toUser['id']];
                    $targetConn->send(json_encode([
                        'type'=>'friend_request',
                        'request_id' => $reqId,
                        'from' => $uid,
                        'from_email' => $this->getUserEmailById($uid),
                        'message' => $message
                    ]));
                    $this->sendFriendRequestsToUser($targetConn, $toUser['id']);
                }
                // resposta final ao remetente
                $from->send(json_encode(['type'=>'add_friend','status'=>'ok','request_id'=>$reqId,'to_user_id'=>$toUser['id'],'to_email'=>$toUser['email']]));
            } catch (\Throwable $e) {
                logmsg('Add friend error: '.$e->getMessage());
                $from->send(json_encode(['type'=>'add_friend','status'=>'error','message'=>'erro ao enviar convite']));
            }
            return;
        }
        // ACCEPT FRIEND
        if ($action === 'accept_friend') {
            $uid = $from->userId;
            $reqId = (int)($decoded['request_id'] ?? 0);
            if (!$uid || !$reqId) { $from->send(json_encode(['type'=>'accept_friend','status'=>'error','message'=>'parâmetros inválidos'])); return; }
            try {
                $stmt = $this->pdo->prepare('SELECT from_user_id,to_user_id FROM friend_requests WHERE id = ? LIMIT 1');
                $stmt->execute([$reqId]);
                $r = $stmt->fetch();
                if (!$r) {
                    $from->send(json_encode(['type'=>'accept_friend','status'=>'error','message'=>'solicitação não encontrada']));
                    return;
                }
                if ((int)$r['to_user_id'] !== (int)$uid) {
                    $from->send(json_encode(['type'=>'accept_friend','status'=>'error','message'=>'não autorizado']));
                    return;
                }

                $other = (int)$r['from_user_id'];

                // transaction: aceita o request e normaliza quaisquer pendentes entre os dois usuários
                $this->pdo->beginTransaction();
                $this->pdo->prepare('UPDATE friend_requests SET status = ?, responded_at = NOW() WHERE id = ?')->execute(['accepted', $reqId]);
                $this->pdo->prepare('UPDATE friend_requests SET status = ?, responded_at = NOW() WHERE status = "pending" AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))')
                    ->execute(['accepted', $other, $uid, $uid, $other]);
                $ins = $this->pdo->prepare('INSERT IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, NOW())');
                $ins->execute([$uid, $other]);
                $ins->execute([$other, $uid]);
                $this->pdo->commit();

                logmsg("Friend request {$reqId} accepted by {$uid}; contacts ensured with {$other}");

                // resposta para quem aceitou
                $from->send(json_encode(['type'=>'accept_friend','status'=>'ok','with'=>$other]));

                // enviar atualizações de convites e contatos para quem aceitou
                $this->sendFriendRequestsToUser($from, $uid);
                $this->sendContactsToUser($from, $uid);

                // se solicitante online, notifica e envia atualizações também
                if (isset($this->userConnections[$other])) {
                    $reqConn = $this->userConnections[$other];
                    $reqConn->send(json_encode(['type'=>'friend_accepted','by'=>$uid]));
                    $this->sendContactsToUser($reqConn, $other);
                    $this->sendFriendRequestsToUser($reqConn, $other);
                }
            } catch (\Throwable $e) {
                try { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); } catch (\Throwable $_) {}
                logmsg('Accept friend error: '.$e->getMessage());
                $from->send(json_encode(['type'=>'accept_friend','status'=>'error','message'=>'erro ao aceitar']));
            }
            return;
        }
        // default unknown action
        $from->send(json_encode(['type'=>'error','message'=>'Ação desconhecida']));
    }

    public function onClose(ConnectionInterface $conn) {
        $this->clients->detach($conn);
        if (isset($conn->userId) && $conn->userId) {
            try { $this->pdo->prepare('UPDATE users SET presence = ?, last_seen = NOW() WHERE id = ?')->execute(['offline', $conn->userId]); } catch (\Throwable $e) { logmsg('Close update error: '.$e->getMessage()); }
            if (isset($this->userConnections[$conn->userId])) unset($this->userConnections[$conn->userId]);
        }
        logmsg("Connection {$conn->resourceId} has disconnected");
    }

    public function onError(ConnectionInterface $conn, \Exception $e) {
        logmsg("An error occurred on connection {$conn->resourceId}: {$e->getMessage()}");
        $conn->close();
    }

    // helper function adicionado à classe Chat (coloque dentro da classe, após outros métodos)
    public function getUserEmailById($id) {
        try {
            $stmt = $this->pdo->prepare('SELECT email FROM users WHERE id = ? LIMIT 1');
            $stmt->execute([$id]);
            return $stmt->fetchColumn();
        } catch (\Throwable $e) {
            return null;
        }
    }

    // Adicione este método dentro da classe Chat (por exemplo após getUserEmailById)
    protected function sendFriendRequestsToUser(ConnectionInterface $conn, $userId) {
        try {
            $stmt = $this->pdo->prepare('SELECT fr.id, fr.from_user_id, u.display_name AS from_name, u.email AS from_email, fr.message, fr.status, fr.created_at FROM friend_requests fr JOIN users u ON fr.from_user_id = u.id WHERE fr.to_user_id = ? AND fr.status = "pending" ORDER BY fr.created_at DESC');
            $stmt->execute([$userId]);
            $incoming = $stmt->fetchAll();

            $stmt = $this->pdo->prepare('SELECT fr.id, fr.to_user_id, u.display_name AS to_name, u.email AS to_email, fr.message, fr.status, fr.created_at FROM friend_requests fr JOIN users u ON fr.to_user_id = u.id WHERE fr.from_user_id = ? AND fr.status = "pending" ORDER BY fr.created_at DESC');
            $stmt->execute([$userId]);
            $outgoing = $stmt->fetchAll();

            $conn->send(json_encode(['type'=>'friend_requests','status'=>'ok','incoming'=>$incoming,'outgoing'=>$outgoing]));
        } catch (\Throwable $e) {
            logmsg('sendFriendRequestsToUser error: ' . $e->getMessage());
        }
    }

    // Adicione este método dentro da classe Chat (por exemplo perto de sendFriendRequestsToUser)
    protected function sendContactsToUser(ConnectionInterface $conn, $userId) {
        try {
            $stmt = $this->pdo->prepare('SELECT c.contact_id AS id, u.display_name, u.email, u.presence, COALESCE(c.group_name,"") AS group_name FROM contacts c JOIN users u ON c.contact_id = u.id WHERE c.user_id = ? ORDER BY u.display_name');
            $stmt->execute([$userId]);
            $contacts = $stmt->fetchAll();
            $conn->send(json_encode(['type'=>'contacts','status'=>'ok','contacts'=>$contacts]));
        } catch (\Throwable $e) {
            logmsg('sendContactsToUser error: ' . $e->getMessage());
        }
    }

    // helper: display name
    public function getUserDisplayNameById($id) {
        try {
            $stmt = $this->pdo->prepare('SELECT display_name FROM users WHERE id = ? LIMIT 1');
            $stmt->execute([$id]);
            return $stmt->fetchColumn();
        } catch (\Throwable $e) { return null; }
    }
}

$porta = 8087;
try {
    $server = IoServer::factory(
        new HttpServer(
            new WsServer(
                new Chat($pdo)
            )
        ),
        $porta
    );
    logmsg("WebSocket server started on port $porta");
    $server->run();
} catch (\Throwable $e) {
    logmsg('FATAL: ' . $e->getMessage());
    exit(1);
}