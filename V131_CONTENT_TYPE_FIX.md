# V131 Content-Type / UTF-8 Fix

- Fixed the public static-file response headers in `server.js`.
- HTML is explicitly served as `text/html; charset=utf-8`.
- CSS, JS, JSON, SVG, TXT, and XML receive explicit MIME types with UTF-8 where appropriate.
- Removed the previous header construction that could produce an invalid/empty content type and cause HTML to render as source text.
- No application workflow, authentication, billing, database, or UI redesign changes were made.
- Verification: `node --check server.js`, `node --check public/auth.js`, and `npm test` all pass; 49/49 tests pass.
