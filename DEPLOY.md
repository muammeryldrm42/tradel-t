# Deploy Rehberi

## Mimari

```
GitHub Repo
├── Railway  → API + Bot + PostgreSQL
└── Vercel   → Dashboard (Next.js)
```

---

## Adım 1: GitHub'a Yükle

```bash
git init
git add .
git commit -m "initial commit"
# GitHub'da yeni repo aç → sonra:
git remote add origin https://github.com/KULLANICIADIN/REPOADI.git
git push -u origin main
```

---

## Adım 2: Railway (API)

1. [railway.app](https://railway.app) → GitHub ile giriş
2. **New Project → Deploy from GitHub repo** → repoyu seç
3. **+ Add → Database → Add PostgreSQL**
4. **`l-ghter-trade` servisine tıkla → Variables → Raw Editor**

Şunu yapıştır:
```
NODE_ENV=production
LOG_LEVEL=info
LOG_PRETTY=false
API_PORT=3001
API_HOST=0.0.0.0
DRY_RUN=true
PAPER_TRADING=true
ENABLE_LIVE_TRADING=false
I_UNDERSTAND_THIS_MAY_LOSE_REAL_MONEY=false
JWT_SECRET=supersecretchangeme123
CORS_ORIGINS=*
LIGHTER_API_URL=https://mainnet.zklighter.elliot.ai
LIGHTER_WS_URL=wss://mainnet.zklighter.elliot.ai/stream
LIGHTER_API_KEY=
```

5. **Settings → Networking → Generate Domain**
6. **Deploy**

Test et: `https://RAILWAY_URL/health` → `{"status":"ok"}` görmeli

---

## Adım 3: Vercel (Dashboard)

1. [vercel.com](https://vercel.com) → GitHub ile giriş
2. **New Project → repoyu import et**
3. **Root Directory: `apps/dashboard`** ← ZORUNLU
4. **Environment Variables:**
```
NEXT_PUBLIC_API_URL=https://RAILWAY_URL
NEXT_PUBLIC_WS_URL=wss://RAILWAY_URL/ws
```
5. **Deploy**

---

## Adım 4: CORS Güncelle

Vercel URL'ini al → Railway Variables güncelle:
```
CORS_ORIGINS=https://VERCEL_URL.vercel.app
```

---

## API Key Ekleme (sonra)

Railway → Variables → sadece şunu ekle:
```
LIGHTER_API_KEY=api_keyini_buraya_yaz
```
Otomatik redeploy olur.
