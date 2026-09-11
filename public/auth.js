/* =====================================================
   PROCUREIQ + CLERK AUTHENTICATION
   Vanilla JavaScript + ClerkJS
===================================================== */

(function () {
    let clerk = null;
    let clerkConfigured = false;

    let authReadyResolve;

    window.procureIQAuthReady = new Promise((resolve) => {
        authReadyResolve = resolve;
    });

    /* =====================================================
       LOAD EXTERNAL SCRIPT
    ===================================================== */

    async function loadExternalScript(src, attributes = {}) {
        await new Promise((resolve, reject) => {
            const script = document.createElement("script");

            script.src = src;
            script.async = true;
            script.crossOrigin = "anonymous";

            Object.entries(attributes).forEach(([name, value]) => {
                script.setAttribute(name, value);
            });

            script.onload = resolve;

            script.onerror = () => {
                reject(
                    new Error(
                        `Failed to load Clerk resource: ${src}`
                    )
                );
            };

            document.head.appendChild(script);
        });
    }

    /* =====================================================
       DECODE CLERK DOMAIN
    ===================================================== */

    function decodeClerkDomain(publishableKey) {
        const encoded = publishableKey?.split("_")?.[2];

        if (!encoded) {
            throw new Error(
                "Invalid Clerk publishable key."
            );
        }

        return atob(encoded).slice(0, -1);
    }

    /* =====================================================
       INITIALIZE CLERK
    ===================================================== */

    async function initializeClerk() {

        const response = await fetch("/api/config", {
            headers: {
                Accept: "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(
                "Unable to load ProcureIQ authentication configuration."
            );
        }

        const config = await response.json();

        clerkConfigured = Boolean(
            config.clerkConfigured &&
            config.clerkPublishableKey
        );

        if (!clerkConfigured) {

            console.warn(
                "ProcureIQ: Clerk is not configured yet."
            );

            updateAuthUI(false);

            authReadyResolve(null);

            return;
        }

        /* =================================================
           CLERK DOMAIN
        ================================================= */

        const domain = decodeClerkDomain(
            config.clerkPublishableKey
        );

        /* =================================================
           LOAD CLERK UI
        ================================================= */

        await loadExternalScript(
            `https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`
        );

        /* =================================================
           LOAD CLERK JS
        ================================================= */

        await loadExternalScript(
            `https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`,
            {
                "data-clerk-publishable-key":
                    config.clerkPublishableKey
            }
        );

        if (!window.Clerk) {
            throw new Error(
                "ClerkJS loaded but the Clerk object is unavailable."
            );
        }

        clerk = window.Clerk;

        /* =================================================
           LOAD CLERK
        ================================================= */

        await clerk.load({
            ui: {
                ClerkUI: window.__internal_ClerkUICtor
            },

            signInFallbackRedirectUrl:
                window.location.origin + "/",

            signUpFallbackRedirectUrl:
                window.location.origin + "/"
        });

        /* =================================================
           EXPOSE CLERK
        ================================================= */

        window.procureIQClerk = clerk;

        /* =================================================
           INITIAL AUTH STATE
        ================================================= */

        updateAuthUI(
            Boolean(clerk.isSignedIn)
        );

        if (typeof window.procureIQOnAuthStateChange === "function") {
            window.procureIQOnAuthStateChange(Boolean(clerk.isSignedIn));
        }

        /* =================================================
           CLERK AUTH STATE LISTENER
        ================================================= */

        clerk.addListener(
            () => {

                // Clerk's own state is the source of truth. Some Clerk
                // listener payloads do not expose session/user consistently.
                const signedIn = Boolean(clerk.isSignedIn);

                updateAuthUI(signedIn);

                if (
                    typeof window.procureIQOnAuthStateChange ===
                    "function"
                ) {
                    window.procureIQOnAuthStateChange(
                        signedIn
                    );
                }

                if (signedIn) {

                    // Being signed in must not force the user into the workspace.
                    // The public home page is a valid signed-in destination.
                    if (window.location.pathname === "/") {
                        return;
                    }

                    /* -------------------------------------
                       CLOSE AUTH MODALS
                    ------------------------------------- */

                    try {
                        clerk.closeSignIn?.();
                    } catch (_) {}

                    try {
                        clerk.closeSignUp?.();
                    } catch (_) {}

                    /* -------------------------------------
                       OPEN WORKSPACE
                    ------------------------------------- */

                    const welcome =
                        document.getElementById(
                            "welcomePage"
                        );

                    const dashboard =
                        document.getElementById(
                            "appShell"
                        );

                    if (
                        welcome &&
                        dashboard &&
                        !dashboard.classList.contains(
                            "is-hidden"
                        )
                    ) {
                        return;
                    }

                    if (
                        window.procureIQAuthAutoOpen
                    ) {
                        window.procureIQAuthAutoOpen();
                    }
                }
            }
        );

        /* =================================================
           AUTH READY
        ================================================= */

        authReadyResolve(clerk);
    }

    /* =====================================================
       GET CLERK SESSION TOKEN
    ===================================================== */

    async function getAuthToken() {

        const auth =
            await window.procureIQAuthReady;

        if (!auth?.session) {
            throw new Error(
                "Please sign in to continue."
            );
        }

        if (!auth.session) {
            await new Promise(resolve => setTimeout(resolve, 250));
            if (!clerk?.session) throw new Error("Please sign in to continue.");
        }
        return (clerk || auth).session.getToken();
    }

    /* =====================================================
       AUTHENTICATED API FETCH
       
       IMPORTANT:
       Both naming styles are supported:
       
       procureIQApiFetch
       procureiqApiFetch
    ===================================================== */

    async function authenticatedFetch(
        url,
        options = {}
    ) {

        const token =
            await getAuthToken();

        const headers =
            new Headers(
                options.headers || {}
            );

        headers.set(
            "Authorization",
            `Bearer ${token}`
        );

        return fetch(
            url,
            {
                ...options,
                headers
            }
        );
    }

    /* =====================================================
       PRIMARY API FUNCTION
    ===================================================== */

    window.procureIQApiFetch =
        authenticatedFetch;

    /* =====================================================
       COMPATIBILITY ALIAS
       
       This prevents:
       "procureiqApiFetch is not defined"
    ===================================================== */

    window.procureiqApiFetch =
        authenticatedFetch;

    /* =====================================================
       SHOW DASHBOARD
    ===================================================== */

    function showDashboard() {
        if (!clerk?.isSignedIn) { openSignIn(); return; }
        const path = window.location.pathname;
        if (!/^\/workspace(?:\/[^/]+)?\/?$/.test(path)) {
            window.location.assign("/workspace/overview");
            return;
        }
        document.getElementById("appShell")?.classList.remove("is-hidden");
        window.scrollTo({ top: 0, behavior: "auto" });
    }

    /* =====================================================
       SHOW WELCOME
    ===================================================== */

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

    /* =====================================================
       SIGN IN
    ===================================================== */

    function openSignIn() {

        if (!clerkConfigured) {

            alert(
                "Clerk authentication is not configured yet. Add CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to your environment variables."
            );

            return;
        }

        if (!clerk) {

            alert(
                "Authentication is still loading. Please try again in a moment."
            );

            return;
        }

        if (clerk.isSignedIn) {

            showDashboard();

            return;
        }

        clerk.openSignIn({
            fallbackRedirectUrl:
                window.location.origin + "/"
        });
    }

    /* =====================================================
       SIGN UP
    ===================================================== */

    function openSignUp() {

        if (!clerkConfigured) {

            alert(
                "Clerk authentication is not configured yet. Add CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to your environment variables."
            );

            return;
        }

        if (!clerk) {

            alert(
                "Authentication is still loading. Please try again in a moment."
            );

            return;
        }

        if (clerk.isSignedIn) {

            showDashboard();

            return;
        }

        clerk.openSignUp({
            fallbackRedirectUrl:
                window.location.origin + "/"
        });
    }

    /* =====================================================
       UPDATE AUTH UI
    ===================================================== */

    function updateAuthUI(signedIn) {

        /* -----------------------------------------------
           SIGN IN BUTTONS
        ----------------------------------------------- */

        document
            .querySelectorAll(
                "[data-auth-sign-in]"
            )
            .forEach((button) => {

                button.classList.toggle(
                    "is-hidden",
                    signedIn
                );
            });

        const heroAuthNote = document.getElementById("heroAuthNote");
        if (heroAuthNote) {
            heroAuthNote.classList.toggle("is-hidden", signedIn);
        }

        /* -----------------------------------------------
           SIGN UP BUTTONS
        ----------------------------------------------- */

        document
            .querySelectorAll(
                "[data-auth-sign-up]"
            )
            .forEach((button) => {

                button.classList.toggle(
                    "is-hidden",
                    signedIn
                );
            });

        /* -----------------------------------------------
           ACCOUNT BUTTONS
        ----------------------------------------------- */

        document
            .querySelectorAll("[data-auth-account]")
            .forEach((button) => {
                button.classList.toggle("is-hidden", !signedIn);
            });

        /* -----------------------------------------------
           OPEN PLATFORM BUTTONS
        ----------------------------------------------- */

        document
            .querySelectorAll(
                "[data-auth-open]"
            )
            .forEach((button) => {

                button.textContent =
                    signedIn
                        ? "Open workspace"
                        : button.dataset.authOpen ===
                          "signup"
                            ? "Get started"
                            : "Open platform";
            });

        /* -----------------------------------------------
           AUTH STATUS
        ----------------------------------------------- */


        const authState =
            document.getElementById(
                "authState"
            );

        if (authState) {

            authState.textContent =
                signedIn
                    ? "Signed in"
                    : "Sign in required";

            authState.classList.toggle(
                "is-authenticated",
                signedIn
            );
        }

        /* -----------------------------------------------
           USER BUTTON
        ----------------------------------------------- */

        if (signedIn) {
            updateAccountIdentity();
        }
    }

    function updateAccountIdentity(planLabel = null) {
        const user = clerk?.user;
        const first = user?.firstName || "";
        const last = user?.lastName || "";
        const fullName = `${first} ${last}`.trim() || user?.username || user?.primaryEmailAddress?.emailAddress || "Account";
        const email = user?.primaryEmailAddress?.emailAddress || "Signed-in workspace";
        const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "DG";
        ["dashboardAccountName", "accountMenuName"].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=fullName; });
        ["accountMenuEmail"].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=email; });
        ["dashboardAccountAvatar"].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=initials; });
        if (planLabel) {
            ["settingsPlan"].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=planLabel; });
        }
    }

    window.procureIQUpdateAccountIdentity = updateAccountIdentity;

    /* =====================================================
       EXPOSE FUNCTIONS
    ===================================================== */

    // Allow the application shell to refresh auth-dependent UI safely.
    window.procureIQRefreshAuthUI = function () {
        updateAuthUI(Boolean(clerk?.isSignedIn));
    };

    window.procureIQShowDashboard =
        showDashboard;

    window.procureIQShowWelcome =
        showWelcome;

    window.procureIQOpenSignIn =
        openSignIn;

    window.procureIQOpenSignUp =
        openSignUp;

    window.procureIQAuthAutoOpen =
        showDashboard;

    /* =====================================================
       WIRE AUTH UI
    ===================================================== */


    function wireAccountMenu() {
        const accountBtn = document.getElementById("dashboardAccountBtn");
        const menu = document.getElementById("accountMenu");
        if (!accountBtn || !menu) return;

        const profile = document.getElementById("accountProfileBtn");
        const settings = document.getElementById("accountSettingsBtn");
        const billing = document.getElementById("accountBillingBtn");
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
            const email = user?.primaryEmailAddress?.emailAddress || "Not available";
            showModal("Profile", `
                <div class="profile-summary"><span class="profile-avatar">${(first[0] || "D") + (last[0] || "G")}</span><div><strong>${first || "Account"} ${last}</strong><span>${email}</span></div></div>
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

        /* -----------------------------------------------
           SIGN IN
        ----------------------------------------------- */

        document
            .querySelectorAll(
                "[data-auth-sign-in]"
            )
            .forEach((button) => {

                button.addEventListener(
                    "click",
                    (event) => {

                        event.preventDefault();

                        openSignIn();
                    }
                );
            });

        /* -----------------------------------------------
           SIGN UP
        ----------------------------------------------- */

        document
            .querySelectorAll(
                "[data-auth-sign-up]"
            )
            .forEach((button) => {

                button.addEventListener(
                    "click",
                    (event) => {

                        event.preventDefault();

                        openSignUp();
                    }
                );
            });

        /* -----------------------------------------------
           OPEN PLATFORM
        ----------------------------------------------- */

        document
            .querySelectorAll(
                "[data-auth-open]"
            )
            .forEach((button) => {

                button.addEventListener(
                    "click",
                    (event) => {

                        event.preventDefault();

                        if (
                            clerk?.isSignedIn
                        ) {
                            showDashboard();
                        } else {
                            openSignIn();
                        }
                    }
                );
            });

        /* -----------------------------------------------
           BACK TO WELCOME
        ----------------------------------------------- */

        document
            .getElementById(
                "backToWelcomeBtn"
            )
            ?.addEventListener(
                "click",
                (event) => {
                    event.preventDefault();
                    showWelcome();
                }
            );

        document
            .getElementById("appBrandHome")
            ?.addEventListener("click", (event) => {
                event.preventDefault();
                window.location.assign("/");
            });
    }

    /* =====================================================
       BOOT
    ===================================================== */

    async function boot() {

        wireAuthUI();
        wireAccountMenu();

        try {

            await initializeClerk();

        } catch (error) {

            console.error(
                "ProcureIQ Clerk initialization failed:",
                error
            );

            window.procureIQAuthError =
                error;

            updateAuthUI(false);

            /*
             * Resolve with null so the rest
             * of the application does not
             * hang forever.
             */

            authReadyResolve(null);
        }
    }

    /* =====================================================
       START
    ===================================================== */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            boot,
            { once: true }
        );

    } else {

        boot();
    }

})();