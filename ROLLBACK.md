# Frontend rollback

Backup created before UI redesign (2026-10-01):

`/home/tar_a/backups/ai-tools-frontend_20261001_172047`

Restore:

```bash
rm -rf /home/tar_a/ai-tools/frontend
cp -a /home/tar_a/backups/ai-tools-frontend_20261001_172047 /home/tar_a/ai-tools/frontend
cd /home/tar_a/ai-tools/frontend && npm run dev
```
