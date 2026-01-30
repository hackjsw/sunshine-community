import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { sign, verify } from 'hono/jwt'

type Bindings = {
  DB: D1Database
  JWT_SECRET: string
}

const DEFAULT_SECRET = "sunshine-secret-key-2026-v26-help-popup-fix";
const app = new Hono<{ Bindings: Bindings }>()

app.use('/*', cors())

async function hashPassword(password: string) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Middleware ---
app.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    try {
      const secret = c.env.JWT_SECRET || DEFAULT_SECRET;
      const payload = await verify(token, secret, "HS256");
      c.set('user', payload);
    } catch (e) {}
  }
  await next();
});

const authRequired = async (c: any, next: any) => {
  const user = c.get('user');
  if (!user) return c.json({ error: '登录失效 🔒' }, 401);
  await next();
}

// ================= API =================

app.get('/api/admin/dashboard', authRequired, async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: '权限不足' }, 403);
  
  const setting = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'allow_register'").first();
  const allowRegister = !setting || setting.value === 'true';

  const sql = `SELECT u.id, u.username, u.nickname, u.role, u.created_at, COUNT(m.id) as memo_count FROM users u LEFT JOIN memos m ON u.id = m.user_id GROUP BY u.id ORDER BY u.created_at DESC`;
  const { results } = await c.env.DB.prepare(sql).all();
  return c.json({ allowRegister, users: results });
});

app.post('/api/admin/toggle-register', authRequired, async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') return c.json({ error: '权限不足' }, 403);
  const { allow } = await c.req.json(); 
  await c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_register', ?)").bind(String(allow)).run();
  return c.json({ success: true, state: allow });
});

app.delete('/api/admin/users/:id', authRequired, async (c) => {
  const operator = c.get('user');
  const targetId = c.req.param('id');
  if (operator.role !== 'admin') return c.json({ error: '权限不足' }, 403);
  if (String(operator.id) === String(targetId)) return c.json({ error: '不能删除自己' }, 400);
  await c.env.DB.prepare("DELETE FROM memos WHERE user_id = ?").bind(targetId).run();
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetId).run();
  return c.json({ success: true });
});

app.put('/api/auth/profile', authRequired, async (c) => {
  const user = c.get('user');
  const { nickname } = await c.req.json();
  if (!nickname || nickname.trim() === "") return c.json({ error: '昵称不能为空' }, 400);
  await c.env.DB.prepare("UPDATE users SET nickname = ? WHERE id = ?").bind(nickname, user.id).run();
  return c.json({ success: true, nickname });
});

app.post('/api/auth/register', async (c) => {
  const { username, password, nickname } = await c.req.json();
  if (!username || !password) return c.json({ error: '请输入账号密码' }, 400);
  const setting = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'allow_register'").first();
  if (setting && setting.value === 'false') return c.json({ error: '管理员已关闭注册通道 🚫' }, 403);
  const exist = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (exist) return c.json({ error: '用户名已存在' }, 409);
  const pwdHash = await hashPassword(password);
  const userCount = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
  const role = (userCount as any).count === 0 ? 'admin' : 'user';
  const finalNickname = nickname || null;
  try {
    await c.env.DB.prepare("INSERT INTO users (username, password, nickname, role, created_at) VALUES (?, ?, ?, ?, ?)").bind(username, pwdHash, finalNickname, role, Date.now()).run();
    return c.json({ success: true });
  } catch (e) { return c.json({ error: '注册失败' }, 500); }
});

app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json();
  const pwdHash = await hashPassword(password);
  const user = await c.env.DB.prepare("SELECT id, username, nickname, role FROM users WHERE username = ? AND password = ?").bind(username, pwdHash).first();
  if (!user) return c.json({ error: '账号或密码错误' }, 401);
  const token = await sign({ id: user.id, username: user.username, role: user.role, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }, c.env.JWT_SECRET || DEFAULT_SECRET, "HS256");
  return c.json({ token, user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role } });
});

app.get('/api/auth/me', authRequired, async (c) => {
    const payload = c.get('user');
    const user = await c.env.DB.prepare("SELECT id, username, nickname, role FROM users WHERE id = ?").bind(payload.id).first();
    return c.json({ user });
});

app.get('/api/memos', async (c) => {
  const user = c.get('user');
  const query = c.req.query('q');
  let sql = "SELECT m.id, m.content, m.tags, m.is_private, m.created_at, m.user_id, u.username, u.nickname, u.role as user_role FROM memos m LEFT JOIN users u ON m.user_id = u.id";
  let conditions = ["(m.is_private = 0 OR m.user_id = ?)"];
  let params: any[] = [user ? user.id : -1];
  if (query) { conditions.push("m.content LIKE ?"); params.push(`%${query}%`); }
  sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY m.created_at DESC LIMIT 200";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(results);
});

app.post('/api/memos', authRequired, async (c) => {
  const user = c.get('user');
  const { content, is_private } = await c.req.json();
  if (!content) return c.json({ error: '内容为空' }, 400);
  const tags = (content.match(/#[^\s#]+/g) || []).join(' ');
  await c.env.DB.prepare("INSERT INTO memos (user_id, content, tags, is_private, created_at) VALUES (?, ?, ?, ?, ?)").bind(user.id, content, tags, is_private ? 1 : 0, Date.now()).run();
  return c.json({ success: true });
});

app.put('/api/memos/:id', authRequired, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const { content } = await c.req.json();
  const memo = await c.env.DB.prepare("SELECT user_id FROM memos WHERE id = ?").bind(id).first();
  if (!memo) return c.json({ error: '不存在' }, 404);
  if (String(memo.user_id) !== String(user.id) && user.role !== 'admin') return c.json({ error: '无权' }, 403);
  const tags = (content.match(/#[^\s#]+/g) || []).join(' ');
  await c.env.DB.prepare("UPDATE memos SET content = ?, tags = ? WHERE id = ?").bind(content, tags, id).run();
  return c.json({ success: true });
});

app.delete('/api/memos/:id', authRequired, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const memo = await c.env.DB.prepare("SELECT user_id FROM memos WHERE id = ?").bind(id).first();
  if (!memo) return c.json({ error: '不存在' }, 404);
  if (String(memo.user_id) !== String(user.id) && user.role !== 'admin') return c.json({ error: '无权' }, 403);
  await c.env.DB.prepare("DELETE FROM memos WHERE id = ?").bind(id).run();
  return c.json({ success: true });
});

// ================= 前端 =================

app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="zh">
    <head>
      <meta charset="UTF-8">
      <meta name="color-scheme" content="light">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <title>Sunshine Community</title>
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
      <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@500;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --glass: rgba(255, 255, 255, 0.7);
          --text: #444;
          --primary: #fda085;
          --primary-grad: linear-gradient(135deg, #f6d365 0%, #fda085 100%);
          --light-color: rgba(255, 250, 240, 0.5); 
        }
        * { box-sizing: border-box; }
        
        body { 
            margin: 0; font-family: 'Quicksand', sans-serif; 
            background: #eef2f3; color: var(--text); 
            overflow: hidden; height: 100vh; width: 100vw;
        }

        #mouse-light {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0;
          background: radial-gradient(600px circle at var(--tx, 50%) var(--ty, 50%), rgba(253, 160, 133, 0.1), transparent 40%);
        }

        .blobs { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; }
        .blob { position: absolute; filter: blur(80px); opacity: 0.6; transition: transform 0.2s ease-out; }
        .b1 { top: -10%; left: -10%; width: 500px; height: 500px; background: #fad0c4; }
        .b2 { bottom: -10%; right: -10%; width: 400px; height: 400px; background: #a18cd1; }

        .layout { 
          display: grid; 
          grid-template-columns: 260px 1fr; 
          max-width: 1200px; 
          margin: 0 auto; 
          height: 100vh; 
          position: relative; 
        }

        .sidebar { 
          position: sticky; top: 0; height: 100vh; 
          padding: 40px 30px; 
          border-right: 2px solid rgba(0,0,0,0.05); 
          display: flex; flex-direction: column; align-items: flex-end; z-index: 50; 
          background: transparent;
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        #timeline-list { margin-top: 50px; }

        .timeline-dot-now { 
          width: 16px; height: 16px; 
          background: var(--primary); 
          border-radius: 50%; 
          box-shadow: 0 0 15px var(--primary); 
          cursor: pointer; 
          position: absolute; 
          right: -9px; 
          top: 40px; 
          z-index: 10; 
          animation: pulse 2s infinite; 
        }
        .timeline-dot-now::after { 
          content: "NOW"; position: absolute; right: 25px; top: -1px; font-size: 12px; font-weight: bold; color: var(--primary); 
        }
        
        .timeline-node { 
          margin: 15px 0; font-size: 15px; color: #777; cursor: pointer; transition: 0.2s; text-align: right; position: relative; width: 100%; font-weight: 500;
        }
        .timeline-node:hover { color: var(--primary); font-weight: bold; transform: scale(1.05); }
        .timeline-node::after { 
          content: ""; position: absolute; 
          right: -35px; 
          top: 6px; width: 8px; height: 8px; background: #ddd; border-radius: 50%; transition: 0.2s;
        }
        .timeline-node:hover::after { background: var(--primary); transform: scale(1.2); }

        /* 内容区 */
        .main-content { 
          padding: 40px 60px 100px 30px; 
          z-index: 2; 
          height: 100vh;
          overflow-y: auto; 
          scroll-behavior: smooth;
          scrollbar-width: none; 
          -ms-overflow-style: none; 
        }
        
        .main-content::-webkit-scrollbar {
            display: none; 
        }

        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
        .logo { font-size: 1.5rem; font-weight: bold; color: #333; letter-spacing: 1px; }
        
        .auth-btns button { border: none; background: transparent; cursor: pointer; font-weight: bold; color: #666; font-family: inherit; padding: 8px 12px; transition: 0.2s; font-size: 0.95rem; }
        .auth-btns button:hover { color: var(--primary); }
        .btn-primary { background: var(--primary-grad) !important; color: white !important; border-radius: 20px; box-shadow: 0 4px 10px rgba(253, 160, 133, 0.4); }
        
        .toolbar { display: flex; gap: 15px; margin-bottom: 20px; align-items: center;}
        .search-box input { width: 100%; min-width: 300px; padding: 12px 20px; border-radius: 50px; border: 2px solid #fff; background: rgba(255,255,255,0.6); outline: none; transition: 0.3s; text-align: center; color: #555; font-size: 1rem; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
        .search-box input:focus { background: #fff; box-shadow: 0 4px 20px rgba(0,0,0,0.1); transform: scale(1.02); }
        
        .status-bar { font-size: 0.9rem; color: #aaa; margin-bottom: 20px; text-align: center; font-weight: bold; letter-spacing: 1px;} 

        .filter-toggle { display: none; align-items: center; gap: 8px; cursor: pointer; color: #777; font-weight: bold; font-size: 0.9rem; user-select: none; background: rgba(255,255,255,0.5); padding: 8px 15px; border-radius: 20px;}
        .filter-toggle.active { color: var(--primary); background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        .filter-check { width: 16px; height: 16px; border: 2px solid #ccc; border-radius: 4px; display: inline-block; position: relative; }
        .filter-toggle.active .filter-check { border-color: var(--primary); background: var(--primary); }

        .admin-trigger { background: #fff0f0; padding: 5px 15px; border-radius: 20px; font-size: 0.85rem; color: #e53e3e; display: flex; align-items: center; gap: 5px; margin-right: 15px; cursor:pointer; border:1px solid transparent; transition:0.2s; }
        .admin-trigger:hover { border-color:#e53e3e; background:#fff; }

        .switch-label { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; color: #666; cursor: pointer; user-select: none; }
        .switch-input { display: none; }
        .switch-track { width: 44px; height: 24px; background: #ddd; border-radius: 24px; position: relative; transition: 0.3s; }
        .switch-track::after { content:""; position: absolute; left: 3px; top: 3px; width: 18px; height: 18px; background: #fff; border-radius: 50%; transition: 0.3s; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
        .switch-input:checked + .switch-track { background: var(--primary); }
        .switch-input:checked + .switch-track::after { left: 23px; }

        .editor-toolbar {
            display: flex; gap: 5px; padding: 10px 10px 5px 10px; border-bottom: 1px solid rgba(0,0,0,0.05);
            margin-bottom: 5px; align-items: center;
        }
        .editor-toolbar button {
            background: rgba(255,255,255,0.5); border: none; border-radius: 6px; 
            width: 32px; height: 32px; cursor: pointer; font-size: 1rem; color: #666; 
            transition: 0.2s; display: flex; justify-content: center; align-items: center;
        }
        .editor-toolbar button:hover { background: #fff; color: var(--primary); box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
        
        .emoji-picker {
            position: absolute; top: 45px; right: 10px; width: 280px; max-height: 250px; overflow-y: auto;
            background: rgba(255, 255, 255, 0.98); backdrop-filter: blur(15px);
            border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); padding: 10px;
            display: grid; grid-template-columns: repeat(auto-fill, minmax(32px, 1fr)); gap: 5px; z-index: 1000;
            border: 1px solid rgba(0,0,0,0.1);
        }
        .emoji-picker::-webkit-scrollbar { width: 6px; }
        .emoji-picker::-webkit-scrollbar-track { background: transparent; }
        .emoji-picker::-webkit-scrollbar-thumb { background: #ddd; border-radius: 3px; }
        .emoji-picker::-webkit-scrollbar-thumb:hover { background: #ccc; }

        .emoji-item { cursor: pointer; font-size: 1.4rem; text-align: center; padding: 4px; border-radius: 6px; transition:0.1s;}
        .emoji-item:hover { background: #f0f2f5; transform:scale(1.2); }

        .toast-container {
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            z-index: 9999; pointer-events: none;
        }
        .toast {
            background: rgba(30, 30, 30, 0.9); color: white; padding: 10px 20px;
            border-radius: 50px; margin-bottom: 10px; font-size: 0.9rem;
            box-shadow: 0 5px 15px rgba(0,0,0,0.2); opacity: 0; transform: translateY(-20px);
            transition: all 0.3s ease; display: flex; align-items: center; gap: 8px;
        }
        .toast.show { opacity: 1; transform: translateY(0); }

        .glass-card, .search-box input, #editor-container { max-width: 750px; width: 100%; }

        .glass-card {
          background: var(--glass); backdrop-filter: blur(20px); border-radius: 24px; padding: 0; 
          margin-bottom: 30px;
          border: 1px solid rgba(255,255,255,0.6); box-shadow: 0 10px 30px rgba(0,0,0,0.05); position: relative; transition: transform 0.2s;
          overflow: visible; 
        }
        .glass-card-inner { padding: 24px; position:relative; z-index:2; }
        
        .glass-card::after {
          content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 1; pointer-events: none;
          background: radial-gradient(500px circle at var(--mx) var(--my), var(--light-color), transparent 40%);
          opacity: 0; transition: opacity 0.2s; border-radius: 24px;
        }
        .glass-card:hover { transform: translateY(-3px); }
        .glass-card:hover::after { opacity: 1; }
        .glass-card.highlight { animation: flashHighlight 1.5s ease-out; border-color: var(--primary); }
        @keyframes flashHighlight { 0% { box-shadow: 0 0 0 0 var(--primary); } 50% { box-shadow: 0 0 20px 5px var(--primary); } 100% { box-shadow: 0 10px 30px rgba(0,0,0,0.05); } }

        .editor-area { width: 100%; min-height: 120px; border: none; background: transparent; font-family: inherit; font-size: 1.1rem; color: #333; outline: none; resize: none; overflow-y: hidden; padding: 10px; margin-top: 0;}
        .editor-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; border-top: 1px dashed rgba(0,0,0,0.1); padding-top: 15px; }
        
        .memo-meta { display: flex; justify-content: space-between; font-size: 0.85rem; color: #888; margin-bottom: 12px; align-items: center; }
        .user-badge { background: #fff; padding: 4px 10px; border-radius: 12px; font-weight: bold; color: #555; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; align-items: center; gap: 6px;}
        .admin-badge { color: #f59e0b; }
        .lock-icon { font-size: 0.8em; margin-left: 5px; color: #999; }
        .memo-content img { max-width: 100%; border-radius: 8px; margin: 10px 0; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
        .memo-content blockquote { border-left: 4px solid var(--primary); background: rgba(255,255,255,0.5); margin: 5px 0; padding: 8px 12px; color: #666; border-radius: 0 8px 8px 0; }
        
        .actions { opacity: 0; transition: 0.2s; display: flex; gap: 15px; position: relative; z-index: 20; }
        .glass-card:hover .actions { opacity: 1; }
        .action-btn { cursor: pointer; font-size: 0.85rem; color: #999; font-weight: bold; display: flex; align-items: center; gap:4px; }
        .action-btn:hover { color: var(--primary); }

        .edit-wrapper textarea { width: 100%; border: 1px solid var(--primary); border-radius: 8px; padding: 10px; font-family: inherit; font-size: 1rem; background: rgba(255,255,255,0.8); outline: none; margin-bottom: 10px; resize: vertical; min-height: 100px;}
        .edit-wrapper .btn-group { display: flex; justify-content: flex-end; gap: 10px; }
        .edit-wrapper button { padding: 4px 12px; border-radius: 12px; border: none; cursor: pointer; font-size: 0.85rem;}
        .save-btn { background: var(--primary); color: white; }
        .cancel-btn { background: #ddd; color: #666; }

        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.8); backdrop-filter: blur(5px); z-index: 100; display: none; justify-content: center; align-items: center; }
        .modal-card { background: #fff; width: 350px; padding: 40px; border-radius: 20px; box-shadow: 0 20px 50px rgba(0,0,0,0.1); text-align: center; position: relative; border: 1px solid #eee; }
        .modal-input { width: 100%; padding: 14px; margin-bottom: 15px; border: 1px solid #eee; border-radius: 10px; background: #f9f9f9; outline: none; font-size: 1rem; }
        .close-modal { position: absolute; top: 15px; right: 20px; cursor: pointer; font-size: 1.5rem; color: #ccc; }
        
        .admin-user-list { text-align: left; max-height: 300px; overflow-y: auto; margin-bottom: 20px; border:1px solid #eee; border-radius: 8px; padding: 10px;}
        .admin-user-item { display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid #f5f5f5; font-size: 0.9rem; align-items: center;}
        .btn-del-user { background: #fee; color: red; border: none; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;}

        .help-wrapper { position: fixed; bottom: 30px; right: 30px; z-index: 100; }
        .help-btn { width: 50px; height: 50px; border-radius: 50%; background: var(--primary-grad); color: white; font-size: 24px; font-weight: bold; border: none; cursor: pointer; box-shadow: 0 4px 15px rgba(253, 160, 133, 0.5); display: flex; justify-content: center; align-items: center; transition: transform 0.3s; animation: pulse 3s infinite; }
        .help-btn:hover { transform: scale(1.1) rotate(10deg); }
        
        /* [修复] 帮助弹窗样式 */
        .help-popup { 
            position: absolute; bottom: 70px; right: 0; 
            width: 450px; /* PC默认宽度 */
            max-width: 85vw; /* 关键：最大宽度不超过屏幕85% */
            background: rgba(255, 255, 255, 0.98); 
            backdrop-filter: blur(25px); 
            border-radius: 20px; 
            padding: 20px; 
            box-shadow: 0 10px 40px rgba(0,0,0,0.15); 
            border: 1px solid rgba(255,255,255,0.8); 
            opacity: 0; 
            transform: translateY(20px) scale(0.9); 
            pointer-events: none; 
            transition: all 0.3s; 
            transform-origin: bottom right; 
            display: grid; 
            grid-template-columns: 1fr 1fr; /* PC端双列 */
            gap: 20px; 
        }
        .help-popup.show { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
        .help-header { font-weight:bold; margin-bottom:10px; color:#ff758c; border-bottom: 1px solid #eee; padding-bottom: 5px; }
        .help-item { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.85rem; color: #555; align-items: center; }
        .help-code { background: #f0f2f5; padding: 2px 6px; border-radius: 4px; font-family: monospace; color: #e91e63; border: 1px solid #e1e4e8; }

        .mobile-toggle { display: none !important; }
        .sidebar-overlay { display: none; }

        @media (max-width: 800px) { 
            .layout { grid-template-columns: 1fr; }
            
            /* [修复] 移动端帮助弹窗单列显示 */
            .help-popup {
                grid-template-columns: 1fr; /* 单列 */
                bottom: 80px;
                right: -10px; /* 微调位置 */
            }

            .mobile-toggle { 
                display: flex !important; 
                position: fixed; top: 15px; left: 15px; 
                width: 40px; height: 40px; background: white; border-radius: 50%;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1); z-index: 1001;
                justify-content: center; align-items: center; font-size: 1.2rem; cursor: pointer;
            }

            .sidebar { 
                position: fixed; left: -220px; top: 0; 
                width: 180px; 
                height: 100%;
                background: #ffffff !important; 
                transition: 0.3s; 
                z-index: 9999; 
                box-shadow: 5px 0 20px rgba(0,0,0,0.1);
                padding-top: 60px;
                border-right: 1px solid rgba(0,0,0,0.05);
            }
            .sidebar.active { left: 0; }
            
            .timeline-node { padding: 5px 0; }

            .sidebar-overlay { 
                position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                background: rgba(0,0,0,0.3); 
                z-index: 9998; 
                opacity: 0; pointer-events: none; transition: 0.3s;
            }
            .sidebar-overlay.active { opacity: 1; pointer-events: auto; display: block; }

            .main-content { 
                padding: 80px 20px 100px 20px; 
                width: 100%; 
            }
            
            .header { flex-direction: column; gap: 10px; align-items: flex-start; margin-left: 40px;}
            .toolbar { flex-direction: column; align-items: stretch; }
            .search-box input { width: 100%; }
            .filter-toggle { justify-content: center; }
            .actions { opacity: 1; } 
        }
      </style>
    </head>
    <body>

      <div id="mouse-light"></div>
      <div class="blobs"><div class="blob b1"></div><div class="blob b2"></div></div>
      
      <div class="toast-container" id="toast-container"></div>

      <div class="mobile-toggle" onclick="toggleSidebar()">📅</div>
      <div class="sidebar-overlay" onclick="toggleSidebar()"></div>

      <div class="layout">
        <aside class="sidebar">
          <div class="timeline-dot-now" onclick="scrollToTop(); toggleSidebar()" title="Back to Now"></div>
          <div id="timeline-list"></div>
        </aside>

        <main class="main-content">
          <header class="header">
            <div class="logo">✨ Sunshine</div>
            <div class="auth-btns" id="auth-section"></div>
          </header>

          <div class="toolbar">
            <div class="search-box">
              <input type="text" placeholder="Search memories..." oninput="handleSearch(this.value)">
            </div>
            <div id="filter-btn" class="filter-toggle" onclick="toggleFilter()">
              <div class="filter-check"></div> Only Mine
            </div>
          </div>
          
          <div class="status-bar" id="status-bar"></div>

          <div id="editor-container" style="display:none">
            <div class="glass-card">
              <div class="editor-toolbar">
                <button onclick="insertMarkdown('bold')" title="加粗 (Bold)"><b>B</b></button>
                <button onclick="insertMarkdown('italic')" title="斜体 (Italic)"><i>I</i></button>
                <button onclick="insertMarkdown('list')" title="列表 (List)">≡</button>
                <button onclick="insertMarkdown('task')" title="任务 (Task)">☑️</button> 
                <button onclick="insertMarkdown('quote')" title="引用 (Quote)">“</button>
                <button onclick="insertMarkdown('code')" title="代码 (Code)">&lt;/&gt;</button>
                <button onclick="insertMarkdown('link')" title="链接 (Link)">🔗</button>
                <button onclick="insertMarkdown('image')" title="图片 (Image)">🖼️</button> 
                <div style="flex:1"></div>
                <button onclick="toggleEmojiPicker()" title="Emoji">😀</button>
              </div>
              
              <div id="emoji-picker" class="emoji-picker" style="display:none"></div>

              <div class="glass-card-inner">
                <textarea id="post-content" class="editor-area" placeholder="记录当下的时光... (Ctrl + Enter 发送)" onkeydown="checkSubmit(event)"></textarea>
                <div class="editor-footer">
                  <label class="switch-label" title="Private Memory">
                    <input type="checkbox" id="post-private" class="switch-input">
                    <div class="switch-track"></div>
                    <span>Private</span>
                  </label>
                  <button class="auth-btns btn-primary" onclick="postMemo()" style="border:none; padding:8px 24px; cursor:pointer;">Post</button>
                </div>
              </div>
            </div>
          </div>

          <div id="memo-list"></div>
        </main>
      </div>

      <div class="help-wrapper">
        <div class="help-popup" id="help-popup">
          <div>
              <div class="help-header">基础语法</div>
              <div class="help-item"><span>标题</span> <span class="help-code"># H1</span></div>
              <div class="help-item"><span>加粗</span> <span class="help-code">**B**</span></div>
              <div class="help-item"><span>引用</span> <span class="help-code">> T</span></div>
              <div class="help-item"><span>列表</span> <span class="help-code">- I</span></div>
          </div>
          <div>
              <div class="help-header">高级</div>
              <div class="help-item"><span>图片</span> <span class="help-code">![a](u)</span></div>
              <div class="help-item"><span>链接</span> <span class="help-code">[t](u)</span></div>
              <div class="help-item"><span>代码</span> <span class="help-code">\`C\`</span></div>
              <div class="help-item"><span>任务</span> <span class="help-code">- [ ]</span></div>
          </div>
          <div style="grid-column: span 2; text-align:center; font-size:0.8rem; color:#aaa; margin-top:10px;">点击外部关闭</div>
        </div>
        <button class="help-btn" onclick="toggleHelp(event)">?</button>
      </div>

      <div class="modal-overlay" id="auth-modal">
        <div class="modal-card">
          <div class="close-modal" onclick="closeModal()">×</div>
          <h3 class="modal-title" id="modal-title">Welcome</h3>
          <input type="text" id="auth-user" class="modal-input" placeholder="Username / ID">
          <input type="password" id="auth-pass" class="modal-input" placeholder="Password" onkeydown="checkLoginSubmit(event)">
          <input type="text" id="auth-nickname" class="modal-input" style="display:none" placeholder="Nickname (Optional)">
          
          <button class="auth-btns btn-primary" onclick="submitAuth()" style="width:100%; padding:14px; border:none; cursor:pointer; font-size:1.1rem" id="modal-submit-btn">Login</button>
          <div style="margin-top:20px; font-size:0.9rem; color:#888; cursor:pointer;" onclick="toggleAuthMode()" id="modal-switch-text">没有账号？去注册</div>
        </div>
      </div>

      <div class="modal-overlay" id="admin-modal">
        <div class="modal-card" style="width: 500px;">
          <div class="close-modal" onclick="document.getElementById('admin-modal').style.display='none'">×</div>
          <h3 class="modal-title">⚡ Admin Console</h3>
          
          <div style="margin-bottom: 20px; text-align: left; background:#f9f9f9; padding:15px; border-radius:10px;">
            <h4 style="margin-top:0">全站设置</h4>
            <label class="switch-label">
              <input type="checkbox" id="admin-reg-switch" class="switch-input" onchange="toggleRegisterSwitch(this.checked)">
              <div class="switch-track"></div>
              <span>开放注册 (Open Registration)</span>
            </label>
          </div>

          <div style="text-align: left;">
            <h4 style="margin-bottom:10px">用户管理</h4>
            <div class="admin-user-list" id="admin-user-list">Loading...</div>
          </div>
        </div>
      </div>

      <script>
        marked.setOptions({ breaks: true, gfm: true });

        let currentUser = null;
        let allMemos = [];
        let isRegisterMode = false;
        let showOnlyMine = false;
        
        const emojis = [
            "😀","😃","😄","😁","😆","😅","😂","🤣","🥲","🥹","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗",
            "😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🥸","🤩","🥳","😏","😒","😞","😔","😟","😕",
            "🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😶‍🌫️","😱","😨",
            "😰","😥","😓","🤗","🤔","🫣","🤭","🫢","🫡","🤫","🫠","🤥","😶","🫥","😐","😑","😬","🙄","😯","😦",
            "👍","👎","👏","🙌","🫶","👐","🤲","🤝","🙏","✍️","💪","🦾","🖕","💅","🤳","👀","🧠","🫀","🫁","🦷",
            "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","🤎","💔","❤️‍🔥","❤️‍🩹","❣️","💕","💞","💓","💗","💖","💘","💝",
            "✨","⭐️","🌟","💫","⚡️","🔥","🌈","☀️","🌤","⛅️","☁️","🌦","🌧","⛈","🌩","🌨","❄️","☃️","⛄️","🌬",
            "🚀","🚁","🚂","🚃","🚄","🚅","🚆","🚇","🚈","🚉","🚊","🚝","🚞","🚋","🚌","🚍","🚎","🚐","🚑","🚒",
            "💻","🖥","🖨","🖱","⌨️","🕹","💽","💾","💿","📀","📼","📷","📸","📹","🎥","📽","🎞","📞","☎️","📟",
            "✅","❎","✳️","❇️","✝️","☮️","🔯","🕎","☯️","☸️","✡️","🕉","☦️","🛐","⛎","♈️","♉️","♊️","♋️","♌️"
        ];

        async function init() {
          const token = localStorage.getItem('token');
          if (token) {
            try {
              const res = await fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } });
              if (res.ok) {
                const data = await res.json();
                currentUser = data.user;
              } else { logout(); }
            } catch(e) { logout(); }
          }
          renderAuthUI();
          loadMemos();
          initEmojiPicker(); 
          document.addEventListener('mousemove', handleGlobalMouseMove);
          checkPermalink();
          
          // 监听输入框自动高度
          const textarea = document.getElementById('post-content');
          textarea.addEventListener('input', () => autoResize(textarea));
        }

        function autoResize(el) {
            el.style.height = 'auto'; 
            el.style.height = el.scrollHeight + 'px'; 
        }

        function toggleSidebar() {
            document.querySelector('.sidebar').classList.toggle('active');
            document.querySelector('.sidebar-overlay').classList.toggle('active');
        }

        function initEmojiPicker() {
            const container = document.getElementById('emoji-picker');
            emojis.forEach(e => {
                const span = document.createElement('span');
                span.className = 'emoji-item';
                span.innerText = e;
                span.onclick = () => { insertText(e); toggleEmojiPicker(); };
                container.appendChild(span);
            });
        }

        function toggleEmojiPicker() {
            const p = document.getElementById('emoji-picker');
            p.style.display = p.style.display === 'none' ? 'grid' : 'none';
        }

        function showToast(message) {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.innerHTML = '✨ ' + message;
            container.appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('show'));
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        function insertMarkdown(type) {
            let text = "";
            let hint = "";
            switch(type) {
                case 'bold': text = "**Bold**"; hint = "已插入加粗"; break;
                case 'italic': text = "*Italic*"; hint = "已插入斜体"; break;
                case 'list': text = "\\n- Item"; hint = "已插入列表"; break;
                case 'task': text = "\\n- [ ] Task"; hint = "已插入任务列表"; break;
                case 'quote': text = "\\n> Quote"; hint = "已插入引用"; break;
                case 'code': text = "\`Code\`"; hint = "已插入代码块"; break;
                case 'link': text = "[Link](url)"; hint = "已插入链接"; break;
                case 'image': text = "![Description](https://example.com/image.png)"; hint = "📸 已插入图片，请替换链接"; break;
            }
            insertText(text);
            showToast(hint);
        }

        function insertText(text) {
            const textarea = document.getElementById('post-content');
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const val = textarea.value;
            textarea.value = val.substring(0, start) + text + val.substring(end);
            if (text.includes("http")) {
                const urlStart = start + text.indexOf("http");
                const urlEnd = start + text.length - 1;
                textarea.setSelectionRange(urlStart, urlEnd);
            } else {
                textarea.selectionStart = textarea.selectionEnd = start + text.length;
            }
            textarea.focus();
            autoResize(textarea); 
        }

        function checkSubmit(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                postMemo();
            }
        }
        
        function checkLoginSubmit(e) {
            if (e.key === 'Enter') {
                submitAuth();
            }
        }

        function checkPermalink() {
            const urlParams = new URLSearchParams(window.location.search);
            const memoId = urlParams.get('memo');
            if (memoId) {
                const checkExist = setInterval(() => {
                    const el = document.getElementById('memo-' + memoId);
                    if (el) {
                        document.querySelector('.main-content').scrollTo({ top: el.offsetTop - 100, behavior: 'smooth' });
                        el.classList.add('highlight');
                        setTimeout(() => el.classList.remove('highlight'), 2000);
                        clearInterval(checkExist);
                        window.history.replaceState({}, document.title, "/");
                    }
                }, 500);
            }
        }

        function handleGlobalMouseMove(e) {
            const x = e.clientX; const y = e.clientY;
            const light = document.getElementById('mouse-light');
            light.style.setProperty('--tx', x + 'px');
            light.style.setProperty('--ty', y + 'px');
            document.querySelectorAll('.glass-card').forEach(card => {
                const rect = card.getBoundingClientRect();
                card.style.setProperty('--mx', (x - rect.left) + 'px');
                card.style.setProperty('--my', (y - rect.top) + 'px');
            });
        }

        function getDisplayName(user) {
            return user.nickname && user.nickname.trim() !== "" ? user.nickname : user.username;
        }

        function renderAuthUI() {
          const container = document.getElementById('auth-section');
          const editor = document.getElementById('editor-container');
          const filterBtn = document.getElementById('filter-btn');
          
          if (currentUser) {
            let adminHtml = currentUser.role === 'admin' ? \`<div class="admin-trigger" onclick="openAdminPanel()">⚡ Admin</div>\` : '';
            const displayName = getDisplayName(currentUser);
            container.innerHTML = \`
              <div style="display:flex; align-items:center">
                \${adminHtml}
                <span style="margin-right:15px; color:#555; font-weight:bold; cursor:pointer" onclick="editNickname()" title="Click to edit nickname">Hi, \${displayName}</span>
                <button onclick="logout()">Logout</button>
              </div>\`;
            editor.style.display = 'block';
            filterBtn.style.display = 'flex';
          } else {
            container.innerHTML = \`<button onclick="openModal('login')">Login</button><button class="btn-primary" onclick="openModal('register')">Join</button>\`;
            editor.style.display = 'none';
            filterBtn.style.display = 'none';
          }
        }
        
        async function editNickname() {
            const newName = prompt("Set your nickname:", currentUser.nickname || "");
            if (newName !== null) {
                const res = await fetch('/api/auth/profile', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('token') },
                    body: JSON.stringify({ nickname: newName })
                });
                if (res.ok) {
                    const data = await res.json();
                    currentUser.nickname = data.nickname;
                    renderAuthUI();
                    loadMemos();
                    showToast("Nickname updated! 🎉");
                } else {
                    alert('Update failed');
                }
            }
        }

        function toggleFilter() {
            showOnlyMine = !showOnlyMine;
            const btn = document.getElementById('filter-btn');
            if(showOnlyMine) btn.classList.add('active'); else btn.classList.remove('active');
            const query = document.querySelector('.search-box input').value;
            renderList(allMemos, query);
        }

        async function loadMemos(query = '') {
          const headers = {};
          if (localStorage.getItem('token')) headers['Authorization'] = 'Bearer ' + localStorage.getItem('token');
          const url = \`/api/memos?q=\${encodeURIComponent(query)}&_t=\${Date.now()}\`;
          const res = await fetch(url, { headers });
          if(res.ok) {
            allMemos = await res.json();
            renderList(allMemos, query);
            renderTimeline(allMemos);
          }
        }

        function renderList(data, query) {
          const container = document.getElementById('memo-list');
          container.innerHTML = '';
          let filteredData = data;
          if (showOnlyMine && currentUser) {
              filteredData = data.filter(m => String(m.user_id) === String(currentUser.id));
          }
          
          document.getElementById('status-bar').innerText = \`Total Memories: \${filteredData.length}\`;

          if(filteredData.length === 0) { container.innerHTML = '<div style="text-align:center; color:#999; margin-top:40px;">暂无记忆...</div>'; return; }

          filteredData.forEach(memo => {
            const card = document.createElement('div');
            card.className = 'glass-card';
            card.id = \`memo-\${memo.id}\`; 
            
            const time = new Date(memo.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit' });
            
            const isMine = currentUser && (String(currentUser.id) === String(memo.user_id) || currentUser.role === 'admin');
            const isPrivate = memo.is_private === 1;

            let badge = '';
            if (memo.user_role === 'admin') badge = '<span class="user-badge admin-badge">⚡ Admin</span>';
            if (isPrivate) badge += ' <span class="lock-icon">🔒</span>';

            const displayName = memo.nickname || memo.username;

            let actions = '';
            if (isMine) {
              actions = \`
                <div class="actions">
                  <span class="action-btn" onclick="enableEdit(\${memo.id})">Edit</span>
                  <span class="action-btn" onclick="deleteMemo(\${memo.id})">Del</span>
                  <span class="action-btn" onclick="shareMemo(\${memo.id})">Share</span>
                </div>
              \`;
            } else {
                actions = \`<div class="actions"><span class="action-btn" onclick="shareMemo(\${memo.id})">Share</span></div>\`;
            }

            let rawContent = memo.content;
            if(query) rawContent = rawContent.replace(new RegExp(\`(\${query})\`, 'gi'), '<mark>$1</mark>');
            
            card.innerHTML = \`
              <div class="glass-card-inner">
                <div class="memo-meta">
                  <div class="user-badge"><img src="https://ui-avatars.com/api/?name=\${displayName}&background=random&size=20&rounded=true" style="margin:0; width:18px; height:18px; border-radius:50%"> \${displayName} \${badge}</div>
                  <div>\${time}</div>
                </div>
                <div class="memo-content" id="content-\${memo.id}">\${marked.parse(rawContent)}</div>
                \${actions}
              </div>
            \`;
            container.appendChild(card);
            const rect = card.getBoundingClientRect();
            card.style.setProperty('--mx', '50%');
            card.style.setProperty('--my', '50%');
          });
        }

        function shareMemo(id) {
            const url = window.location.origin + '?memo=' + id;
            navigator.clipboard.writeText(url).then(() => { showToast('链接已复制到剪贴板 🔗'); });
        }

        function enableEdit(id) {
          const memo = allMemos.find(m => m.id === id);
          if(!memo) return;
          const contentDiv = document.getElementById(\`content-\${id}\`);
          contentDiv.innerHTML = \`<div class="edit-wrapper"><textarea id="edit-area-\${id}">\${memo.content}</textarea><div class="btn-group"><button class="cancel-btn" onclick="loadMemos()">Cancel</button><button class="save-btn" onclick="saveEdit(\${id})">Save</button></div></div>\`;
        }

        async function saveEdit(id) {
           const newContent = document.getElementById(\`edit-area-\${id}\`).value;
           if(!newContent) return;
           const res = await fetch(\`/api/memos/\${id}\`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('token') }, body: JSON.stringify({ content: newContent }) });
           if(res.ok) { loadMemos(); showToast('保存成功 ✅'); } else alert('保存失败');
        }

        async function openAdminPanel() {
            document.getElementById('admin-modal').style.display = 'flex';
            const res = await fetch('/api/admin/dashboard', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') } });
            const data = await res.json();
            document.getElementById('admin-reg-switch').checked = data.allowRegister;
            const listEl = document.getElementById('admin-user-list');
            listEl.innerHTML = '';
            data.users.forEach(u => {
                const div = document.createElement('div');
                div.className = 'admin-user-item';
                const roleTag = u.role === 'admin' ? '<span style="color:orange; font-weight:bold">[Admin]</span>' : '';
                const delBtn = u.role !== 'admin' ? \`<button class="btn-del-user" onclick="deleteUser(\${u.id})">Delete</button>\` : '<span style="color:#ccc; font-size:0.8rem">不可删</span>';
                const display = u.nickname ? \`\${u.nickname} (@\${u.username})\` : u.username;
                div.innerHTML = \`<div>\${display} \${roleTag} <span style="font-size:0.8em; color:#999; margin-left:10px">记忆数: \${u.memo_count}</span></div>\${delBtn}\`;
                listEl.appendChild(div);
            });
        }

        async function toggleRegisterSwitch(newState) {
          const res = await fetch('/api/admin/toggle-register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('token') }, body: JSON.stringify({ allow: newState }) });
          if(!res.ok) { alert('操作失败'); document.getElementById('admin-reg-switch').checked = !newState; }
        }

        async function deleteUser(id) {
            if(!confirm('确定删除该用户及其所有记忆吗？此操作不可逆！')) return;
            const res = await fetch(\`/api/admin/users/\${id}\`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') } });
            if(res.ok) { openAdminPanel(); loadMemos(); showToast("用户已删除"); } else alert('删除失败');
        }

        function renderTimeline(data) {
          const sidebar = document.getElementById('timeline-list');
          sidebar.innerHTML = '';
          const groups = {};
          data.forEach(m => {
            const date = new Date(m.created_at);
            const key = \`\${date.getFullYear()}-\${date.getMonth()+1}\`;
            if(!groups[key]) groups[key] = { year: date.getFullYear(), month: date.getMonth()+1, firstId: m.id };
          });
          Object.values(groups).forEach(g => {
            const node = document.createElement('div');
            node.className = 'timeline-node';
            node.innerText = \`\${g.year} . \${g.month}\`;
            node.onclick = () => {
                const el = document.getElementById(\`memo-\${g.firstId}\`);
                if(el) {
                    document.querySelector('.main-content').scrollTo({ top: el.offsetTop - 100, behavior: 'smooth' });
                    if(window.innerWidth <= 800) toggleSidebar();
                }
            };
            sidebar.appendChild(node);
          });
        }

        function scrollToTop() { document.querySelector('.main-content').scrollTo({ top: 0, behavior: 'smooth' }); }

        async function postMemo() {
          const content = document.getElementById('post-content').value;
          const isPrivate = document.getElementById('post-private').checked;
          const res = await fetch('/api/memos', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('token') }, body: JSON.stringify({ content, is_private: isPrivate }) });
          if(res.ok) { 
              document.getElementById('post-content').value = ''; 
              document.getElementById('post-content').style.height = 'auto';
              loadMemos(); 
              showToast('发布成功！🎉');
          } 
          else { const data = await res.json(); if(res.status === 401) { alert('登录失效'); logout(); } else alert(data.error || '发布失败'); }
        }

        async function deleteMemo(id) {
          if(!confirm('确定删除吗？')) return;
          const res = await fetch(\`/api/memos/\${id}\`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') } });
          if(res.ok) { loadMemos(); showToast('记忆已删除 🗑️'); } else { if(res.status === 401) { alert('登录失效'); logout(); } else alert('删除失败'); }
        }

        function openModal(mode) { 
            document.getElementById('auth-modal').style.display = 'flex'; 
            isRegisterMode = (mode === 'register'); 
            document.getElementById('modal-title').innerText = isRegisterMode ? 'Join' : 'Welcome'; 
            document.getElementById('modal-submit-btn').innerText = isRegisterMode ? 'Register' : 'Login'; 
            document.getElementById('modal-switch-text').innerText = isRegisterMode ? 'Login ->' : 'Register ->'; 
            document.getElementById('auth-nickname').style.display = isRegisterMode ? 'block' : 'none';
        }
        function closeModal() { document.getElementById('auth-modal').style.display = 'none'; }
        function toggleAuthMode() { closeModal(); openModal(isRegisterMode ? 'login' : 'register'); }
        function logout() { localStorage.removeItem('token'); currentUser = null; location.reload(); }

        async function submitAuth() {
          const u = document.getElementById('auth-user').value;
          const p = document.getElementById('auth-pass').value;
          const n = document.getElementById('auth-nickname').value; 
          
          const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
          const body = { username: u, password: p };
          if(isRegisterMode) body.nickname = n; 

          const res = await fetch(endpoint, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
          const data = await res.json();
          if(res.ok) { 
              if(isRegisterMode) { 
                  showToast('注册成功，请登录 ✨'); 
                  toggleAuthMode(); 
              } else { 
                  localStorage.setItem('token', data.token); 
                  currentUser = data.user; 
                  closeModal(); 
                  renderAuthUI(); 
                  loadMemos(); 
                  showToast(\`欢迎回来, \${getDisplayName(currentUser)} 👋\`);
              } 
          } else alert(data.error);
        }

        function toggleHelp(e) { e.stopPropagation(); document.getElementById('help-popup').classList.toggle('show'); }
        document.addEventListener('click', (e) => { if(!e.target.closest('.help-wrapper')) document.getElementById('help-popup').classList.remove('show'); });
        let searchTimeout;
        function handleSearch(val) { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { loadMemos(val); }, 300); }

        init();
      </script>
    </body>
    </html>
  `)
})

export default app