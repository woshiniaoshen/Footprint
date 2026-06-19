# Nelson Tan Portfolio and Footprint

This repository builds two pages in one Vite deployment:

- `/` - Nelson Tan's cybersecurity and project portfolio
- `/footprint/` - the Footprint travel mapping application

## Local development

```bash
npm install
npm run dev
```

Open:

- `http://127.0.0.1:5173/`
- `http://127.0.0.1:5173/footprint/`

## Production build

```bash
npm run build
```

Vite writes both entry pages to `dist/`. The existing Cloudflare deployment can serve the portfolio and Footprint from the same custom domain.

Firebase password reset links return users to `/footprint/`.
