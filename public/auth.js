/*
 * ProcureIQ authentication — rebuilt from scratch (V128)
 *
 * Authentication source of truth: Clerk.
 * V132: use the documented Clerk load flow and avoid passing legacy routing options to load().
 * - Google OAuth
 * - Email + password
 * - Clerk-managed session and sign-up/verification tasks
 * - Custom email + password sign-in UI backed by Clerk
 * - Standard Google OAuth with account selection
 * - Forgot password via secure email reset link
 * - Shared Clerk session token for protected ProcureIQ APIs
 *
 * This file intentionally does not implement a second password system in the
 * browser. That removes the old custom sign-in state machine and lets Clerk
 * own the complete authentication lifecycle.
 */
(function () {
    "use strict";

    let clerk = null;
    let clerkConfigured = false;
    let authMountNode = null;
    let authReadyResolve;

    window.procureIQAuthReady = new Promise((resolve) => {
        authReadyResolve = resolve;
    });

    function safeText(value) {
        return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[ch]));
    }

    function repairMojibake(root = document) {
        const replacements = new Map([
            ["\u00e2\u201a\u00b9", "\u20b9"],
            ["\u00e2\u20ac\u2122", "\u2019"],
            ["\u00e2\u20ac\u0153", "\u201c"],
            ["\u00e2\u20ac\x9d", "\u201d"],
            ["\u00e2\u20ac\x93", "\u2013"],
            ["\u00e2\u20ac\x94", "\u2014"],
            ["\u00e2\u2020\u2019", "\u2192"],
            ["\u00c2", ""]
        ]);
        const repair = value => {
            let output = String(value ?? "");
            for (const [bad, good] of replacements) output = output.split(bad).join(good);
            return output;
        };
        const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node => {
            const fixed = repair(node.nodeValue);
            if (fixed !== node.nodeValue) node.nodeValue = fixed;
        });
        (root.querySelectorAll ? root.querySelectorAll("[title],[placeholder],[aria-label]") : []).forEach(el => {
            ["title", "placeholder", "aria-label"].forEach(name => {
                if (el.hasAttribute(name)) el.setAttribute(name, repair(el.getAttribute(name)));
            });
        });
    }

    function errorMessage(error, fallback = "Authentication could not be completed. Please try again.") {
        const first = error?.errors?.[0];
        return first?.longMessage || first?.message || error?.message || fallback;
    }

    async function loadScript(src) {
        if (document.querySelector(`script[data-procureiq-clerk-src="${CSS.escape(src)}"]`)) {
            return;
        }

        await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.async = true;
            script.crossOrigin = "anonymous";
            script.dataset.procureiqClerkSrc = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error("Unable to load the Clerk authentication library."));
            document.head.appendChild(script);
        });
    }

    function decodeClerkDomain(publishableKey) {
        const encoded = String(publishableKey || "").split("_")[2];
        if (!encoded) throw new Error("The Clerk publishable key is invalid.");

        try {
            return atob(encoded).replace(/\$$/, "");
        } catch (_) {
            throw new Error("The Clerk publishable key could not be decoded.");
        }
    }

    async function fetchRuntimeConfig() {
        const response = await fetch("/api/config", {
            headers: { Accept: "application/json" },
            credentials: "same-origin",
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("Unable to load ProcureIQ authentication configuration.");
        }

        return response.json();
    }

    async function initializeClerk() {
        const config = await fetchRuntimeConfig();

        clerkConfigured = Boolean(
            config?.clerkConfigured &&
            config?.clerkPublishableKey
        );

        if (!clerkConfigured) {
            updateAuthUI(false);
            authReadyResolve(null);
            return null;
        }

        const domain = decodeClerkDomain(config.clerkPublishableKey);
        // The custom ProcureIQ password sign-in surface only needs ClerkJS.
        // Clerk UI is an optional enhancement used by the hosted sign-up flow;
        // a failure to load it must never disable email/password sign-in.
        let clerkUiAvailable = false;
        try {
            const clerkUiScript = document.createElement("script");
            clerkUiScript.src = `https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`;
            clerkUiScript.async = true;
            clerkUiScript.crossOrigin = "anonymous";
            clerkUiScript.dataset.procureiqClerkUi = "true";
            await new Promise((resolve) => {
                clerkUiScript.onload = () => { clerkUiAvailable = true; resolve(); };
                clerkUiScript.onerror = () => resolve();
                document.head.appendChild(clerkUiScript);
            });
        } catch (_) {
            clerkUiAvailable = false;
        }

        const clerkScript = document.createElement("script");
        clerkScript.src = `https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
        clerkScript.async = false;
        clerkScript.crossOrigin = "anonymous";
        clerkScript.setAttribute("data-clerk-publishable-key", config.clerkPublishableKey);
        clerkScript.dataset.procureiqClerkSrc = clerkScript.src;
        await new Promise((resolve, reject) => {
            clerkScript.onload = resolve;
            clerkScript.onerror = () => reject(new Error("Unable to load the Clerk authentication library."));
            document.head.appendChild(clerkScript);
        });

        /*
         * When ClerkJS is loaded with the documented browser <script> tag,
         * window.Clerk is the already-created Clerk instance. It is NOT the
         * class constructor used by the npm/module integration. Calling
         * Instantiating the browser global as a constructor breaks the CDN
         * integration. Use the already-created browser instance instead.
         *
         * Support both documented browser shapes so the authentication layer
         * remains robust across Clerk CDN releases:
         *   1. browser script -> window.Clerk instance with load()
         *   2. module-like global -> constructor function
         */
        const ClerkGlobal = window.Clerk;
        if (!ClerkGlobal) {
            throw new Error("Unable to initialize Clerk authentication.");
        }

        if (typeof ClerkGlobal === "function") {
            clerk = new ClerkGlobal(config.clerkPublishableKey);
        } else if (typeof ClerkGlobal === "object" && typeof ClerkGlobal.load === "function") {
            clerk = ClerkGlobal;
        } else {
            throw new Error("Unable to initialize the Clerk authentication client.");
        }

        // Use the optional UI constructor when it is available. Otherwise load
        // ClerkJS normally so the custom email/password sign-in remains usable.
        const clerkUICtor = clerkUiAvailable ? window.__internal_ClerkUICtor : null;
        if (clerkUICtor) {
            await clerk.load({ ui: { ClerkUI: clerkUICtor } });
        } else {
            await clerk.load();
        }

        window.procureIQClerk = clerk;

        updateAuthUI(Boolean(clerk.isSignedIn));

        clerk.addListener(() => {
            const signedIn = Boolean(clerk?.isSignedIn);
            updateAuthUI(signedIn);

            if (typeof window.procureIQOnAuthStateChange === "function") {
                window.procureIQOnAuthStateChange(signedIn);
            }

            if (signedIn) {
                closeAuthSurface();
                updateAccountIdentity();
            }
        });

        authReadyResolve(clerk);
        return clerk;
    }

    async function getAuthToken() {
        const auth = await window.procureIQAuthReady;
        const session = auth?.session || clerk?.session;

        if (!session) {
            throw new Error("Please sign in to continue.");
        }

        const token = await session.getToken();
        if (!token) throw new Error("Your sign-in session has expired. Please sign in again.");
        return token;
    }

    async function authenticatedFetch(url, options = {}) {
        const token = await getAuthToken();
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${token}`);

        return fetch(url, {
            ...options,
            headers,
            credentials: "same-origin"
        });
    }

    window.procureIQApiFetch = authenticatedFetch;
    window.procureiqApiFetch = authenticatedFetch;

    function showDashboard() {
        if (!clerk?.isSignedIn) {
            openSignIn();
            return;
        }

        if (!/^\/workspace(?:\/[^/]+)?\/?$/.test(window.location.pathname)) {
            window.location.assign("/workspace/overview");
            return;
        }

        document.getElementById("appShell")?.classList.remove("is-hidden");
        window.scrollTo({ top: 0, behavior: "auto" });
    }

    function showWelcome() {
        if (window.location.pathname !== "/") {
            window.location.assign("/");
            return;
        }

        document.getElementById("appShell")?.classList.add("is-hidden");
        document.getElementById("welcomePage")?.classList.remove("is-hidden");
        document.title = "ProcureIQ | Smarter Spending. Better Decisions.";
        window.scrollTo({ top: 0, behavior: "auto" });
    }

    function authAppearance() {
        return {
            variables: {
                colorPrimary: "#245dcc",
                colorText: "#172b45",
                colorTextSecondary: "#68798d",
                colorBackground: "#ffffff",
                colorInputBackground: "#ffffff",
                colorInputText: "#172b45",
                borderRadius: "10px",
                fontFamily: "Inter, system-ui, sans-serif"
            },
            elements: {
                card: { boxShadow: "none", border: "0", width: "100%" },
                headerTitle: { fontSize: "24px", letterSpacing: "-0.03em" },
                headerSubtitle: { color: "#68798d", fontSize: "13px" },
                formFieldLabel: { fontSize: "12px", fontWeight: "700" },
                formFieldInput: { borderRadius: "9px", minHeight: "44px", fontSize: "14px" },
                formButtonPrimary: { borderRadius: "9px", minHeight: "44px", fontSize: "14px", fontWeight: "700" },
                footerActionLink: { color: "#245dcc" },
                socialButtonsBlockButton: { borderRadius: "9px", minHeight: "44px", fontSize: "13px" },
                identityPreviewEditButton: { color: "#245dcc" }
            }
        };
    }

    function closeAuthSurface() {
        try {
            if (authMountNode && clerk?.unmountSignIn) clerk.unmountSignIn(authMountNode);
            if (authMountNode && clerk?.unmountSignUp) clerk.unmountSignUp(authMountNode);
        } catch (_) {}
        authMountNode = null;
        document.querySelector(".piq-auth-overlay")?.remove();
        document.body.classList.remove("piq-auth-open");
    }

    function openForgotPassword() {
        if (!clerkConfigured || !clerk) {
            alert("Authentication is still loading. Please try again in a moment.");
            return;
        }
        if (clerk.isSignedIn) {
            showDashboard();
            return;
        }
        // Clerk's prebuilt SignIn contains the native Forgot password flow.
        clerk.openSignIn({
            fallbackRedirectUrl: "/workspace/overview",
            signUpFallbackRedirectUrl: "/workspace/overview",
            appearance: authAppearance(),
            oauthFlow: "auto"
        });
    }

    function openSignIn() {
        if (!clerkConfigured || !clerk) {
            alert("Authentication is still loading. Please try again in a moment.");
            return;
        }
        if (clerk.isSignedIn) {
            showDashboard();
            return;
        }
        // Use Clerk's prebuilt authentication UI so password visibility,
        // verification, forgot-password, OAuth and session tasks all stay
        // aligned with the Clerk instance configuration.
        try {
            clerk.openSignIn({
                fallbackRedirectUrl: "/workspace/overview",
                signUpFallbackRedirectUrl: "/workspace/overview",
                appearance: authAppearance(),
                oauthFlow: "auto"
            });
        } catch (error) {
            console.error("Unable to open Clerk sign-in:", error);
            alert("Sign-in could not be opened. Please try again.");
        }
    }

    function openSignUp() {
        if (!clerkConfigured || !clerk) {
            alert("Authentication is still loading. Please try again in a moment.");
            return;
        }
        if (clerk.isSignedIn) {
            showDashboard();
            return;
        }
        try {
            if (typeof clerk.openSignUp !== "function") {
                alert("Sign-up UI could not be loaded. Please refresh the page and try again.");
                return;
            }
            clerk.openSignUp({
                fallbackRedirectUrl: "/workspace/overview",
                signUpFallbackRedirectUrl: "/workspace/overview",
                signInFallbackRedirectUrl: "/workspace/overview",
                appearance: authAppearance()
            });
        } catch (error) {
            console.error("Unable to open Clerk sign-up:", error);
            alert("Sign-up could not be opened. Please try again.");
        }
    }

    function updateAuthUI(signedIn) {
        document.querySelectorAll("[data-auth-sign-in]").forEach((button) => {
            button.classList.toggle("is-hidden", signedIn);
        });

        document.querySelectorAll("[data-auth-sign-up]").forEach((button) => {
            button.classList.toggle("is-hidden", signedIn);
        });

        document.querySelectorAll("[data-auth-account]").forEach((button) => {
            button.classList.toggle("is-hidden", !signedIn);
        });

        const heroAuthNote = document.getElementById("heroAuthNote");
        heroAuthNote?.classList.toggle("is-hidden", signedIn);

        document.querySelectorAll("[data-auth-open]").forEach((button) => {
            if (signedIn) {
                button.textContent = "Open workspace";
            } else if (button.dataset.authOpen === "signup") {
                button.textContent = "Get started";
            } else {
                button.textContent = "Open platform";
            }
        });

        const authState = document.getElementById("authState");
        if (authState) {
            authState.textContent = signedIn ? "Signed in" : "Sign in required";
            authState.classList.toggle("is-authenticated", signedIn);
        }

        if (signedIn) updateAccountIdentity();
    }

    function updateAccountIdentity(planLabel = null) {
        const user = clerk?.user;
        const first = user?.firstName || "";
        const last = user?.lastName || "";
        const fullName = user?.fullName?.trim() || `${first} ${last}`.trim() || user?.username || user?.primaryEmailAddress?.emailAddress || "Account";
        const email = user?.primaryEmailAddress?.emailAddress || "Signed-in workspace";
        const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "A";

        ["dashboardAccountName", "accountMenuName"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.textContent = fullName;
        });

        const accountEmail = document.getElementById("accountMenuEmail");
        if (accountEmail) accountEmail.textContent = email;

        const avatar = document.getElementById("dashboardAccountAvatar");
        if (avatar) avatar.textContent = initials;

        if (planLabel) {
            ["settingsPlan", "dashboardAccountPlan", "accountMenuPlan"].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.textContent = planLabel;
            });
        }
    }

    window.procureIQUpdateAccountIdentity = updateAccountIdentity;
    window.procureIQRefreshAuthUI = () => updateAuthUI(Boolean(clerk?.isSignedIn));
    window.procureIQShowDashboard = showDashboard;
    window.procureIQShowWelcome = showWelcome;
    window.procureIQOpenSignIn = openSignIn;
    window.procureIQOpenSignUp = openSignUp;
    window.procureIQOpenForgotPassword = openForgotPassword;
    window.procureIQAuthAutoOpen = showDashboard;

    function wireAccountMenu() {
        const accountBtn = document.getElementById("dashboardAccountBtn");
        const menu = document.getElementById("accountMenu");
        if (!accountBtn || !menu) return;

        const profile = document.getElementById("accountProfileBtn");
        const settings = document.getElementById("accountSettingsBtn");
        const billing = document.getElementById("accountBillingBtn");
        const sidebarUpgrade = document.getElementById("sidebarUpgradeBtn");
        const headerUpgrade = document.getElementById("headerTokenUpgradeBtn");
        const help = document.getElementById("accountHelpBtn");
        const signOut = document.getElementById("accountSignOutBtn");

        // Keep the menu inside the account block. This prevents the sidebar
        // from changing width and keeps the popover anchored to the account row.
        menu.style.position = "absolute";
        menu.style.left = "50%";
        menu.style.right = "auto";
        menu.style.transform = "translateX(-50%)";
        menu.style.top = "calc(100% + 8px)";

        const closeMenu = () => {
            menu.classList.add("is-hidden");
            accountBtn.setAttribute("aria-expanded", "false");
        };
        const openMenu = () => {
            menu.classList.remove("is-hidden");
            accountBtn.setAttribute("aria-expanded", "true");
        };

        // Capture phase makes this independent of sidebar/nav click handlers.
        accountBtn.addEventListener("click", (event) => {
            // The Upgrade control sits visually inside the account row, but it
            // must remain an independent action. Do not let the parent account
            // toggle handler consume its click.
            if (event.target.closest("#sidebarUpgradeBtn")) return;
            event.preventDefault();
            event.stopPropagation();
            const isOpen = !menu.classList.contains("is-hidden");
            if (isOpen) closeMenu(); else openMenu();
        }, true);

        menu.addEventListener("click", (event) => { event.stopPropagation(); });
        document.addEventListener("click", (event) => {
            if (event.target.closest("#dashboardAccountBtn") || event.target.closest("#accountMenu")) return;
            closeMenu();
        }, true);

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeMenu();
        });
        const showModal = (title, bodyHTML, onReady) => {
            closeMenu();
            document.querySelector(".account-modal-backdrop")?.remove();
            const backdrop = document.createElement("div");
            backdrop.className = "account-modal-backdrop";
            backdrop.innerHTML = `
                <div class="account-modal" role="dialog" aria-modal="true" aria-label="${title}">
                    <div class="account-modal-head">
                        <div><span class="account-modal-kicker">ACCOUNT</span><h2>${title}</h2></div>
                        <button type="button" class="account-modal-close" aria-label="Close">×</button>
                    </div>
                    <div class="account-modal-body">${bodyHTML}</div>
                </div>`;
            document.body.appendChild(backdrop);
            const close = () => backdrop.remove();
            backdrop.querySelector(".account-modal-close")?.addEventListener("click", close);
            backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });
            onReady?.(backdrop, close);
        };

        profile?.addEventListener("click", (event) => {
            event.preventDefault();
            const user = clerk?.user;
            const first = user?.firstName || "";
            const last = user?.lastName || "";
            const fullName = user?.fullName?.trim() || `${first} ${last}`.trim() || user?.username || user?.primaryEmailAddress?.emailAddress || "Account";
            const email = user?.primaryEmailAddress?.emailAddress || "Not available";
            showModal("Profile", `
                <div class="profile-summary"><span class="profile-avatar">${fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "A"}</span><div><strong>${safeText(fullName)}</strong><span>${safeText(email)}</span></div></div>
                <div class="profile-fields">
                    <label>First name<input id="profileFirstName" value="${String(first).replace(/"/g, '&quot;')}"></label>
                    <label>Last name<input id="profileLastName" value="${String(last).replace(/"/g, '&quot;')}"></label>
                    <label>Email address<input value="${String(email).replace(/"/g, '&quot;')}" disabled></label>
                </div>
                <p id="profileStatus" class="account-modal-status"></p>
                <div class="account-modal-actions"><button type="button" class="secondary-btn" data-close>Cancel</button><button type="button" class="primary-cta" id="saveProfileBtn">Save changes</button></div>
            `, (backdrop, close) => {
                backdrop.querySelector("[data-close]")?.addEventListener("click", close);
                backdrop.querySelector("#saveProfileBtn")?.addEventListener("click", async () => {
                    const status = backdrop.querySelector("#profileStatus");
                    const btn = backdrop.querySelector("#saveProfileBtn");
                    try {
                        btn.disabled = true;
                        status.textContent = "Saving…";
                        if (!clerk?.user?.update) throw new Error("Your account session is not ready yet. Please try again.");
                        await clerk.user.update({
                            firstName: backdrop.querySelector("#profileFirstName").value.trim(),
                            lastName: backdrop.querySelector("#profileLastName").value.trim()
                        });
                        updateAccountIdentity();
                        status.textContent = "Profile updated successfully.";
                        setTimeout(close, 650);
                    } catch (err) {
                        status.textContent = err?.message || "Unable to update your profile.";
                    } finally { btn.disabled = false; }
                });
            });
        });

        settings?.addEventListener("click", (event) => {
            event.preventDefault();
            let prefs = {};
            try { prefs = JSON.parse(localStorage.getItem("procureiqPreferences") || "{}"); } catch (_) {}
            const reportsCount = (() => { try { return JSON.parse(localStorage.getItem("procureiq_report_history_v2") || "[]").length; } catch (_) { return 0; } })();
            const currentDensity = prefs.compact === false ? "Comfortable" : "Compact";
            showModal("Settings", `
                <div class="settings-shell">
                    <div class="settings-intro">
                        <div><span class="settings-kicker">ACCOUNT PREFERENCES</span><h3>Make ProcureIQ work the way you prefer.</h3><p>Manage notifications, dashboard density and your local reports. Account identity and sign-in security remain managed by Clerk.</p></div>
                        <span class="settings-live-badge"><i></i> Saved locally</span>
                    </div>

                    <section class="settings-panel">
                        <div class="settings-panel-head"><div><strong>Workspace preferences</strong><span>Control how the dashboard behaves.</span></div></div>
                        <label class="settings-option"><span><strong>Analysis notifications</strong><small>Show status feedback after uploads, analysis and workspace actions.</small></span><input type="checkbox" id="prefNotifications" ${prefs.notifications !== false ? "checked" : ""}><span class="settings-switch" aria-hidden="true"></span></label>
                        <label class="settings-option"><span><strong>Compact opportunity rows</strong><small>Use denser investigation rows so more opportunities fit on screen.</small></span><input type="checkbox" id="prefCompact" ${prefs.compact !== false ? "checked" : ""}><span class="settings-switch" aria-hidden="true"></span></label>
                        <div class="settings-info-row"><span>Current opportunity density</span><strong id="settingsDensityValue">${currentDensity}</strong></div>
                    </section>

                    <section class="settings-panel">
                        <div class="settings-panel-head"><div><strong>Account & security</strong><span>Your login identity is securely handled by Clerk.</span></div></div>
                        <div class="settings-action-row"><div><strong>Profile & identity</strong><small>Update your name and account details.</small></div><button type="button" class="settings-outline-btn" id="settingsOpenProfile">Open profile</button></div>
                        <div class="settings-action-row"><div><strong>Session</strong><small>Sign out of this ProcureIQ session from the account menu.</small></div><button type="button" class="settings-outline-btn" id="settingsCloseModal">Done</button></div>
                    </section>

                    <section class="settings-panel">
                        <div class="settings-panel-head"><div><strong>Data & privacy</strong><span>Your reports and preferences are stored locally in this browser; transaction data is retrieved from your authenticated workspace.</span></div></div>
                        <div class="settings-data-grid">
                            <div class="settings-stat"><span>Saved reports</span><strong>${reportsCount}</strong></div>
                            <div class="settings-stat"><span>Preference storage</span><strong>Browser</strong></div>
                        </div>
                        <div class="settings-action-row"><div><strong>Download workspace data</strong><small>Export your accessible procurement transactions and report history as a JSON file.</small></div><button type="button" class="settings-outline-btn" id="settingsExportData">Download</button></div>
                        <div class="settings-action-row settings-danger-row"><div><strong>Reset local preferences</strong><small>Restore default dashboard preferences and remove saved report history from this browser.</small></div><button type="button" class="settings-danger-btn" id="settingsResetLocal">Reset</button></div>
                        <div class="settings-action-row settings-danger-row"><div><strong>Delete ProcureIQ account</strong><small>Permanently remove your ProcureIQ workspace data and authentication account. This cannot be undone.</small></div><button type="button" class="settings-danger-btn" id="settingsDeleteAccount">Delete account</button></div>
                    </section>

                    <p id="settingsStatus" class="settings-feedback" role="status"></p>
                    <div class="settings-footer"><span>ProcureIQ Settings</span><button type="button" class="primary-cta" id="saveSettingsBtn">Save preferences</button></div>
                </div>
            `, (backdrop, close) => {
                const notificationInput = backdrop.querySelector("#prefNotifications");
                const compactInput = backdrop.querySelector("#prefCompact");
                const density = backdrop.querySelector("#settingsDensityValue");
                const status = backdrop.querySelector("#settingsStatus");
                const setStatus = (message, error = false) => { status.textContent = message; status.classList.toggle("is-error", error); };
                const updateDensity = () => { density.textContent = compactInput.checked ? "Compact" : "Comfortable"; };
                compactInput?.addEventListener("change", updateDensity);

                backdrop.querySelector("#saveSettingsBtn")?.addEventListener("click", () => {
                    const preferences = { notifications: Boolean(notificationInput?.checked), compact: Boolean(compactInput?.checked) };
                    localStorage.setItem("procureiqPreferences", JSON.stringify(preferences));
                    localStorage.setItem("procureiq_settings_v1", JSON.stringify({ notifications: preferences.notifications, compactView: preferences.compact }));
                    document.documentElement.classList.toggle("compact-preference-off", !preferences.compact);
                    document.querySelector(".opportunities")?.classList.toggle("compact-preference-off", !preferences.compact);
                    setStatus("Preferences saved.");
                    setTimeout(close, 550);
                });

                backdrop.querySelector("#settingsCloseModal")?.addEventListener("click", close);
                backdrop.querySelector("#settingsOpenProfile")?.addEventListener("click", () => {
                    close();
                    profile?.click();
                });

                backdrop.querySelector("#settingsExportData")?.addEventListener("click", async (e) => {
                    const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Preparing…";
                    try {
                        let transactions = [];
                        const apiFetch = window.procureIQApiFetch || window.procureiqApiFetch;
                        const response = apiFetch ? await apiFetch("/api/transactions") : await fetch("/api/transactions");
                        if (response.ok) { const payload = await response.json(); transactions = Array.isArray(payload) ? payload : (payload.transactions || []); }
                        const reportHistory = (() => { try { return JSON.parse(localStorage.getItem("procureiq_report_history_v2") || "[]"); } catch (_) { return []; } })();
                        const exportPayload = { exported_at: new Date().toISOString(), product: "ProcureIQ", transactions, saved_reports: reportHistory, preferences: (() => { try { return JSON.parse(localStorage.getItem("procureiqPreferences") || "{}"); } catch (_) { return {}; } })() };
                        const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `procureiq-workspace-${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                        setStatus("Workspace data downloaded.");
                    } catch (err) { console.error(err); setStatus("Could not download workspace data. Please try again.", true); }
                    finally { btn.disabled = false; btn.textContent = "Download"; }
                });

                backdrop.querySelector("#settingsDeleteAccount")?.addEventListener("click", async (e) => {
                    const btn = e.currentTarget;
                    const confirmed = window.confirm("Delete your ProcureIQ account and all ProcureIQ workspace data? This cannot be undone.");
                    if (!confirmed) return;
                    btn.disabled = true; btn.textContent = "Deleting…";
                    try {
                        const apiFetch = window.procureIQApiFetch || window.procureiqApiFetch;
                        const response = apiFetch ? await apiFetch("/api/account/delete", { method: "POST" }) : await fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" } });
                        const payload = await response.json().catch(() => ({}));
                        if (!response.ok || !payload.success) throw new Error(payload.error || "Account deletion failed.");
                        localStorage.removeItem("procureiqPreferences");
                        localStorage.removeItem("procureiq_settings_v1");
                        localStorage.removeItem("procureiq_report_history_v2");
                        setStatus("Account deleted. Signing you out…");
                        setTimeout(async () => { try { await clerk?.signOut?.(); } finally { window.location.assign("/"); } }, 500);
                    } catch (err) {
                        console.error(err);
                        btn.disabled = false; btn.textContent = "Delete account";
                        setStatus(err.message || "Could not delete the account. Please try again.", true);
                    }
                });

                backdrop.querySelector("#settingsResetLocal")?.addEventListener("click", () => {
                    if (!window.confirm("Reset local preferences and delete saved report history from this browser?")) return;
                    localStorage.removeItem("procureiqPreferences"); localStorage.removeItem("procureiq_settings_v1"); localStorage.removeItem("procureiq_report_history_v2");
                    notificationInput.checked = true; compactInput.checked = true; updateDensity();
                    document.documentElement.classList.remove("compact-preference-off"); document.querySelector(".opportunities")?.classList.remove("compact-preference-off");
                    setStatus("Local preferences and saved report history were reset.");
                });
            });
        });

        billing?.addEventListener("click", (event) => { event.preventDefault(); closeMenu(); window.location.assign("/workspace/billing"); });
        const goBilling = (event) => { event.preventDefault(); event.stopPropagation(); window.location.assign("/workspace/billing"); };
        sidebarUpgrade?.addEventListener("click", goBilling);
        headerUpgrade?.addEventListener("click", goBilling);
        sidebarUpgrade?.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") goBilling(event);
        });
        help?.addEventListener("click", (event) => { event.preventDefault(); closeMenu(); window.location.assign("/workspace/help"); });
        signOut?.addEventListener("click", async (event) => {
            event.preventDefault();
            closeMenu();
            try { await clerk?.signOut?.(); } finally { showWelcome(); }
        });

        const savingsHero = document.getElementById("savingsHero");
        if (savingsHero && !savingsHero.dataset.accountWired) {
            savingsHero.dataset.accountWired = "true";
            const openAnalysis = () => {
                const target = document.getElementById("uploadDropzone") || document.getElementById("dashboardOverview");
                target?.scrollIntoView({ behavior: "smooth", block: "start" });
                document.getElementById("csvFile")?.focus({ preventScroll: true });
            };
            savingsHero.addEventListener("click", openAnalysis);
            savingsHero.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openAnalysis(); } });
        }
    }
    function wireAuthUI() {
        document.querySelectorAll("[data-auth-sign-in]").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault();
                openSignIn();
            });
        });

        document.querySelectorAll("[data-auth-sign-up]").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault();
                openSignUp();
            });
        });

        document.querySelectorAll("[data-auth-open]").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault();
                if (clerk?.isSignedIn) showDashboard();
                else openSignIn();
            });
        });

        document.getElementById("backToWelcomeBtn")?.addEventListener("click", (event) => {
            event.preventDefault();
            showWelcome();
        });

        document.getElementById("appBrandHome")?.addEventListener("click", (event) => {
            event.preventDefault();
            window.location.assign("/");
        });
    }

    async function boot() {
        wireAuthUI();
        wireAccountMenu();

        try {
            await initializeClerk();
        } catch (error) {
            console.error("ProcureIQ authentication initialization failed:", error);
            window.procureIQAuthError = error;
            updateAuthUI(false);
            authReadyResolve(null);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();
