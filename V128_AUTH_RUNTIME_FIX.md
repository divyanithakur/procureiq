# V128 Auth Runtime Fix

Fixed:
1. ClerkJS now receives the required publishable key on its script tag, and the Clerk UI bundle is loaded before ClerkJS.
2. Removed the invalid cross-scope initDashboardHover() call from the first animation observer.

The local environment/.env is intentionally not included. Copy your existing environment file into the extracted environment folder.
