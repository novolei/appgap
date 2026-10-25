ALTER TABLE users ADD COLUMN last_login_at TEXT;
UPDATE users SET last_login_at=(SELECT MAX(created_at) FROM user_sessions WHERE user_id=users.id);
