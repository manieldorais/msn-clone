/* Banco para MSN clone - esquema minimal funcional para desenvolvimento local */
CREATE DATABASE IF NOT EXISTS `msn` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `msn`;

-- Usuários
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) DEFAULT NULL, -- armazene bcrypt/argon2
  status_message VARCHAR(255) DEFAULT NULL,
  presence ENUM('online','away','busy','offline') DEFAULT 'offline',
  avatar_url VARCHAR(512) DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Solicitações de amizade / convites
CREATE TABLE IF NOT EXISTS friend_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_user_id INT UNSIGNED NOT NULL,
  to_user_id INT UNSIGNED NOT NULL,
  message VARCHAR(512) DEFAULT NULL,
  status ENUM('pending','accepted','declined','cancelled') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_fr_from_user FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_fr_to_user FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_request (from_user_id, to_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Contatos / amizades (armazenar cada relação em ambas direções se desejar)
CREATE TABLE IF NOT EXISTS contacts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  contact_id INT UNSIGNED NOT NULL,
  group_name VARCHAR(80) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_contact_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_contact_contact FOREIGN KEY (contact_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_contact (user_id, contact_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Conversas (salas) - tipo private (1:1) ou group
CREATE TABLE IF NOT EXISTS conversations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type ENUM('private','group') NOT NULL DEFAULT 'private',
  title VARCHAR(255) DEFAULT NULL,
  created_by INT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_message_id INT UNSIGNED DEFAULT NULL,
  CONSTRAINT fk_conv_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Participantes da conversa
CREATE TABLE IF NOT EXISTS conversation_participants (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_admin TINYINT(1) DEFAULT 0,
  CONSTRAINT fk_part_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_part_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_participant (conversation_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Mensagens
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT UNSIGNED NOT NULL,
  sender_id INT UNSIGNED DEFAULT NULL, -- NULL para mensagens do sistema
  content TEXT,
  content_type ENUM('text','system','file') DEFAULT 'text',
  reply_to BIGINT UNSIGNED DEFAULT NULL,
  is_deleted TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  edited_at TIMESTAMP NULL DEFAULT NULL,
  delivered_at TIMESTAMP NULL DEFAULT NULL,
  read_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_msg_reply FOREIGN KEY (reply_to) REFERENCES messages(id) ON DELETE SET NULL,
  INDEX idx_conv_created (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Anexos (opcional)
CREATE TABLE IF NOT EXISTS attachments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT UNSIGNED NOT NULL,
  filename VARCHAR(255),
  mime VARCHAR(120),
  url VARCHAR(1024),
  size BIGINT DEFAULT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attach_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pequenas tabelas de suporte (ex: sessões/token de login)
CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(64) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  ip VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Exemplo de dados iniciais (substitua password_hash por hash real)
-- Gere hash com: php -r "echo password_hash('senha123', PASSWORD_BCRYPT).PHP_EOL;"
INSERT INTO users (email, display_name, password_hash, status_message, presence)
VALUES
  ('daniel@example.com','Daniel','$2y$10$examplehashreplace','Ouvindo música','online'),
  ('fulano@example.com','Fulano','$2y$10$examplehashreplace','Disponível','online');

-- Cria conversa privada entre 1 e 2
INSERT INTO conversations (type, title, created_by) VALUES ('private', NULL, 1);
SET @conv_id = LAST_INSERT_ID();
INSERT INTO conversation_participants (conversation_id, user_id) VALUES (@conv_id, 1), (@conv_id, 2);

-- Mensagens de exemplo
INSERT INTO messages (conversation_id, sender_id, content, content_type) VALUES
(@conv_id, 2, 'E aí cara, beleza? Tocou aquele som novo?', 'text'),
(@conv_id, 1, 'Opa, beleza! Sim, ficou muito bom.', 'text');

-- Atualiza last_message_id
UPDATE conversations SET last_message_id = (SELECT id FROM messages WHERE conversation_id = @conv_id ORDER BY created_at DESC LIMIT 1) WHERE id = @conv_id;

-- Índices adicionais úteis
ALTER TABLE users ADD INDEX idx_email (email);
ALTER TABLE messages ADD INDEX idx_sender (sender_id);
ALTER TABLE friend_requests ADD INDEX idx_fr_status (status);