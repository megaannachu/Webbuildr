import { createClient } from '@supabase/supabase-js';

    // This file powers up the whole website. It keeps track of the logged-in user,
    // the saved sites, and the website builder state.
    // Basically,  it updates the page,
    // and saves the user's content whenever they change something.
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const supabase = supabaseUrl && supabasePublishableKey
      ? createClient(supabaseUrl, supabasePublishableKey)
      : null;
    let currentUser = null;
    let currentSites = [];
    const TEMPLATE_OPTIONS = [
      { id: "blank", name: "Blank Site", description: "A clean page for your own ideas." }
    ];
    const BLOCK_TONES = ["ink", "rose", "moss"];
    const BUILDER_FONT_FAMILY = '"DynaPuff", system-ui';
    const DESIGN_PRESETS = {
      backgrounds: { paper: "#ffffff", mint: "#e9f6f0", blush: "#fff0f4", butter: "#fff8df" },
      fonts: { serif: BUILDER_FONT_FAMILY, sans: BUILDER_FONT_FAMILY, playful: BUILDER_FONT_FAMILY }
    };
    let activeBuilderSiteId = "";
    let activeBuilderSite = null;
    let activeBuilderPageId = "";
    let activeBuilderTab = "pages";
    let selectedBlockId = "";
    let pointerDragBlockId = "";
    let pointerDragTargetId = "";
    let pointerDragAfterTarget = false;
    let builderSaveTimer = 0;

    // These open and close the pop-up auth forms.
    // They simply add or remove a CSS class that makes the overlay visible.
    function show(id) {
      document.getElementById(id).classList.add("active");
    }

    function hide(id) {
      document.getElementById(id).classList.remove("active");
    }

    function openSignIn() {
      show("signinOverlay");
      clearMessage("signinMessage");
    }

    function closeSignIn() {
      hide("signinOverlay");
    }

    function openCreateAccount() {
      show("createAccountOverlay");
      clearMessage("createMessage");
    }

    function closeCreateAccount() {
      hide("createAccountOverlay");
    }

    function switchToCreateAccount() {
      closeSignIn();
      openCreateAccount();
    }

    function switchToSignIn() {
      closeCreateAccount();
      openSignIn();
    }

    // Basic validation checks so we do not accept non usable email addresses
    // or usernames that are too short or use invalid characters.
    function isValidEmail(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function isValidUsername(username) {
      return /^[A-Za-z0-9_]{3,20}$/.test(username);
    }

    // Show a message under a form. The type changes the CSS color.
    function setMessage(id, text, type) {
      const message = document.getElementById(id);
      message.textContent = text;
      message.className = "account-message " + type;
    }

    function clearMessage(id) {
      setMessage(id, "", "");
    }

    // Escape user text before injecting it into HTML. This prevents weird
    // characters from breaking the page or creating HTML injection issues.
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      })[character]);
    }

    // Display a small user avatar or the first letter of their username.
    function renderAvatar(element, user) {
      if (!element) return;
      const imageData = typeof user?.avatarDataUrl === "string" && user.avatarDataUrl.startsWith("data:image/jpeg;base64,") ? user.avatarDataUrl : "";
      element.replaceChildren();
      if (imageData) {
        const image = document.createElement("img");
        image.className = "avatar-image";
        image.src = imageData;
        image.alt = "";
        element.append(image);
      } else {
        element.textContent = user?.username?.trim().charAt(0).toUpperCase() || "?";
      }
    }

    function setAppStatus(message) {
      const status = document.getElementById("appStatus");
      status.textContent = message;
      status.hidden = !message;
    }

    // Use GitHub OAuth so the user can log in without making a password.
    // Supabase handles the redirect and returns them to the app after sign-in.
    async function signInWithGitHub(messageId = "signinMessage") {
      if (!supabase) {
        setMessage(messageId, "Supabase is not configured.", "error");
        return;
      }
      try {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "github",
          options: {
            redirectTo: window.location.origin
          }
        });
        if (error) throw error;
      } catch (error) {
        setMessage(messageId, error.message || "Could not connect to GitHub.", "error");
      }
    }

    // These functions manage the currently signed-in user and the list of saved sites.
    // The app keeps this data in memory so it can update the dashboard quickly.
    function getSignedInUser() {
      return currentUser;
    }

    function getSites() {
      return currentSites;
    }

    async function saveSites(sites) {
      const user = getSignedInUser();
      if (!user) throw new Error("Sign in before saving a site.");
      const rows = sites.map(site => ({
        id: site.id,
        user_id: user.id,
        title: site.title,
        template: site.template,
        site_data: site,
        updated_at: new Date(site.updatedAt).toISOString()
      }));
      if (rows.length) {
        const { error } = await supabase.from("sites").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
      currentSites = sites;
    }

    // The builder works with reusable blocks like text, buttons, and images.
    // Each block needs a unique ID so the app can find and edit the correct one.
    function createId() {
      if (window.crypto?.randomUUID) return window.crypto.randomUUID();

      // Use random bytes when the browser does not support randomUUID().
      const bytes = window.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    function makeBlock(type, content = {}) {
      // Every block has default content and styling, but the user can later change it.
      const defaults = {
        heading: { text: "PLACEHOLDER" },
        text: { text: "PLACEHOLDER" },
        image: { src: "", alt: "" },
        button: { text: "PLACEHOLDER", href: "#" },
        divider: {}
      };
      return {
        id: createId(),
        type,
        content: { ...(defaults[type] || {}), ...content },
        style: { align: "left", tone: "ink" }
      };
    }

    function starterBlocks(template) {
      if (template === "portfolio") {
        return [
          makeBlock("heading", { text: "My Portfolio" }),
          makeBlock("text", { text: "PLACEHOLDER" }),
          makeBlock("button", { text: "See my work", href: "#" })
        ];
      }

      if (template === "studio") {
        return [
          makeBlock("heading", { text: "Welcome to my studio" }),
          makeBlock("text", { text: "PLACEHOLDER" }),
          makeBlock("button", { text: "Get in touch", href: "mailto:hello@example.com" })
        ];
      }

      return [];
    }

    function ensureSitePages(site) {
      // Make sure every saved site has at least one page and valid design settings.
      // This prevents crashes when old projects are loaded from Supabase.
      if (!Array.isArray(site.pages) || !site.pages.length) {
        site.pages = [{ id: "page-home", title: "Home", blocks: starterBlocks(site.template) }];
      }
      site.pages.forEach(page => {
        if (!Array.isArray(page.blocks)) page.blocks = [];
      });
      if (!site.design || typeof site.design !== "object") site.design = {};
      if (!DESIGN_PRESETS.backgrounds[site.design.background]) site.design.background = "paper";
      if (!DESIGN_PRESETS.fonts[site.design.font]) site.design.font = "serif";
      return site;
    }

    function getSiteBlocks(site) {
      ensureSitePages(site);
      let page = site.pages[0];
      for (const sitePage of site.pages) {
        if (sitePage.id === activeBuilderPageId) {
          page = sitePage;
          break;
        }
      }
      activeBuilderPageId = page.id;
      return page.blocks;
    }

    function makeNewSite(title, template) {
      return {
        id: createId(),
        title,
        template,
        design: { background: "paper", font: "serif" },
        pages: [{ id: "page-home", title: "Home", blocks: starterBlocks(template) }],
        updatedAt: Date.now()
      };
    }

    function blockTone(block) {
      const tone = block.style?.tone;
      if (BLOCK_TONES.includes(tone)) return tone;
      return "ink";
    }

    function blockAlignment(block) {
      const alignment = block.style?.align;
      if (alignment === "left" || alignment === "center" || alignment === "right") {
        return alignment;
      }
      return "left";
    }

    function safeWebAddress(value) {
      const address = String(value || "").trim();
      return /^(https?:|mailto:|tel:|#)/i.test(address) ? address : "";
    }

    // This turns a stored block object into something visible on the builder canvas.
    // We create a real DOM element based on the block type, like heading or image.
    function makeCanvasBlock(block) {
      const element = document.createElement("div");
      element.className = `canvas-block tone-${blockTone(block)} align-${blockAlignment(block)}`;
      element.dataset.blockId = block.id;
      element.tabIndex = 0;
      element.setAttribute("role", "button");
      element.setAttribute("aria-pressed", String(block.id === selectedBlockId));
      if (block.id === selectedBlockId) element.classList.add("selected");

      let content;
      if (block.type === "heading") {
        content = document.createElement("h1");
        content.textContent = block.content.text || "";
      } else if (block.type === "text") {
        content = document.createElement("p");
        content.textContent = block.content.text || "";
      } else if (block.type === "image") {
        const source = safeWebAddress(block.content.src);
        if (source) {
          content = document.createElement("img");
          content.src = source;
          content.alt = block.content.alt || "";
        } else {
          content = document.createElement("div");
          content.className = "canvas-image-placeholder";
          content.setAttribute("aria-hidden", "true");
        }
      } else if (block.type === "button") {
        content = document.createElement("span");
        content.className = "canvas-button-preview";
        content.textContent = block.content.text || "Button";
      } else {
        content = document.createElement("hr");
      }
      content.classList.add("canvas-block-content");
      element.append(content);
      return element;
    }

    // Repaint the website editor for the currently selected site.
    // The builder shows the canvas, page tabs, and the editing panel together.
    function renderBuilder() {
      const site = activeBuilderSite;
      if (!site) return closeBuilder();
      const blocks = getSiteBlocks(site);
      const canvas = document.getElementById("builderCanvas");
      canvas.replaceChildren();
      for (const block of blocks) {
        canvas.append(makeCanvasBlock(block));
      }
      canvas.style.backgroundColor = DESIGN_PRESETS.backgrounds[site.design.background];
      canvas.style.fontFamily = DESIGN_PRESETS.fonts[site.design.font];
      document.getElementById("builderSiteName").value = site.title;
      const page = site.pages.find(item => item.id === activeBuilderPageId);
      document.getElementById("builderCurrentPageTitle").textContent = page.title.toUpperCase();
      renderBuilderPanel(site);
      renderBlockInspector(blocks.find(block => block.id === selectedBlockId));
    }

    function renderBuilderPanel(site) {
      // This is the side panel where the user can switch between Pages and Elements.
      const panel = document.getElementById("builderPanelContent");
      const page = site.pages.find(item => item.id === activeBuilderPageId) || site.pages[0];
      const tabTitles = { pages: "Pages", elements: "Elements" };
      document.querySelectorAll(".builder-tab").forEach(button => {
        const selected = button.dataset.builderTab === activeBuilderTab;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", String(selected));
      });
      document.getElementById("builderPanel").setAttribute("aria-labelledby", `builderTab${activeBuilderTab[0].toUpperCase()}${activeBuilderTab.slice(1)}`);
      if (activeBuilderTab === "pages") {
        panel.innerHTML = `<h2>${tabTitles.pages}</h2><div class="builder-page-list">${site.pages.map(item => `<button class="button-secondary builder-page-item ${item.id === page.id ? "active" : ""}" type="button" data-page-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.title)}</span></button>`).join("")}</div><button class="button-secondary builder-add-page" type="button" data-action="add-page">＋ Add page</button><label class="builder-page-name">Page name<input id="builderPageName" maxlength="40" value="${escapeHtml(page.title)}"></label>${site.pages.length > 1 ? '<button class="button-danger builder-delete-page" type="button" data-action="delete-page">Delete page</button>' : ""}`;
      } else {
        panel.innerHTML = `<h2>${tabTitles.elements}</h2><div class="builder-element-list"><button class="button-secondary" type="button" data-add-block="heading">Heading</button><button class="button-secondary" type="button" data-add-block="text">Text</button><button class="button-secondary" type="button" data-add-block="image">Image</button><button class="button-secondary" type="button" data-add-block="button">Button</button><button class="button-secondary" type="button" data-add-block="divider">Divider</button></div>`;
      }
    }

    function addBuilderPage() {
      // A page is another section in the website, like separate tabs or sections.
      if (!activeBuilderSite) return;
      const page = { id: window.crypto?.randomUUID?.() || `page-${Date.now()}`, title: `Page ${activeBuilderSite.pages.length + 1}`, blocks: [] };
      activeBuilderSite.pages.push(page);
      activeBuilderPageId = page.id;
      selectedBlockId = "";
      renderBuilder();
      scheduleBuilderSave();
    }

    function deleteBuilderPage() {
      if (!activeBuilderSite || activeBuilderSite.pages.length < 2) return;
      const pageIndex = activeBuilderSite.pages.findIndex(page => page.id === activeBuilderPageId);
      activeBuilderSite.pages = activeBuilderSite.pages.filter(page => page.id !== activeBuilderPageId);
      activeBuilderPageId = activeBuilderSite.pages[Math.max(0, pageIndex - 1)].id;
      selectedBlockId = "";
      renderBuilder();
      scheduleBuilderSave();
    }

    function renderBlockInspector(block) {
      // This panel lets the user edit the selected block's content and alignment.
      const inspector = document.getElementById("builderInspector");
      if (!block) {
        inspector.replaceChildren();
        return;
      }
      const contentField = block.type === "image"
        ? `<label>Image URL<input data-property="src" type="url" value="${escapeHtml(block.content.src || "")}"></label><label>Alt text<input data-property="alt" value="${escapeHtml(block.content.alt || "")}"></label>`
        : block.type === "divider"
          ? ""
          : `<label>${block.type === "heading" ? "Heading" : block.type === "button" ? "Button label" : "Text"}<textarea data-property="text" rows="${block.type === "heading" ? 3 : 5}" maxlength="500">${escapeHtml(block.content.text || "")}</textarea></label>${block.type === "button" ? `<label>Link<input data-property="href" type="url" value="${escapeHtml(block.content.href || "")}"></label>` : ""}`;
      inspector.innerHTML = `${contentField}<label>Alignment<select data-style="align"><option value="left" ${blockAlignment(block) === "left" ? "selected" : ""}>Left</option><option value="center" ${blockAlignment(block) === "center" ? "selected" : ""}>Center</option><option value="right" ${blockAlignment(block) === "right" ? "selected" : ""}>Right</option></select></label><div class="inspector-actions"><button class="button-secondary" type="button" data-action="move-block-up">Move up</button><button class="button-secondary" type="button" data-action="move-block-down">Move down</button><button class="button-secondary" type="button" data-action="duplicate-block">Duplicate</button><button class="button-danger" type="button" data-action="delete-block">Delete block</button></div>`;
    }

    function openBuilder(siteId) {
      // Open the full website builder for a chosen site and hide the dashboard.
      const site = getSites().find(item => item.id === siteId);
      if (!site) return;
      activeBuilderSiteId = site.id;
      activeBuilderSite = site;
      ensureSitePages(site);
      activeBuilderPageId = site.pages[0].id;
      activeBuilderTab = "pages";
      selectedBlockId = "";
      document.querySelector(".dashboard-topbar").hidden = true;
      document.getElementById("dashboardContent").hidden = true;
      document.getElementById("builderEditor").hidden = false;
      renderBuilder();
    }

    function closeBuilder() {
      // Exit builder mode and save the current site before returning to the dashboard.
      window.clearTimeout(builderSaveTimer);
      persistBuilderSite();
      activeBuilderSiteId = "";
      activeBuilderSite = null;
      activeBuilderPageId = "";
      selectedBlockId = "";
      document.getElementById("builderEditor").hidden = true;
      document.querySelector(".dashboard-topbar").hidden = false;
      document.getElementById("dashboardContent").hidden = false;
      showDashboardView("sites");
    }

    function scheduleBuilderSave() {
      document.getElementById("builderSaveStatus").textContent = "Unsaved changes";
      window.clearTimeout(builderSaveTimer);
      builderSaveTimer = window.setTimeout(() => {
        document.getElementById("builderSaveStatus").textContent = "Saving...";
        persistBuilderSite().then(saved => {
          document.getElementById("builderSaveStatus").textContent = saved ? "Saved" : "Could not save";
        }).catch(error => {
          document.getElementById("builderSaveStatus").textContent = "Could not save";
          setAppStatus(`Could not save your site: ${error.message}`);
        });
      }, 350);
    }

    async function persistBuilderSite() {
      if (!activeBuilderSite) return false;
      const sites = getSites();
      const index = sites.findIndex(site => site.id === activeBuilderSiteId);
      if (index < 0) return false;
      activeBuilderSite.updatedAt = Date.now();
      sites[index] = activeBuilderSite;
      await saveSites(sites);
      return true;
    }

    function addBuilderBlock(type) {
      const site = activeBuilderSite;
      if (!site) return;
      const block = makeBlock(type);
      getSiteBlocks(site).push(block);
      selectedBlockId = block.id;
      renderBuilder();
      scheduleBuilderSave();
    }

    function moveSelectedBlock(offset) {
      const site = activeBuilderSite;
      if (!site) return;
      const blocks = getSiteBlocks(site);
      const index = blocks.findIndex(block => block.id === selectedBlockId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= blocks.length) return;
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      renderBuilder();
      scheduleBuilderSave();
    }

    function duplicateSelectedBlock() {
      const site = activeBuilderSite;
      if (!site) return;
      const blocks = getSiteBlocks(site);
      const index = blocks.findIndex(block => block.id === selectedBlockId);
      if (index < 0) return;
      const clone = JSON.parse(JSON.stringify(blocks[index]));
      clone.id = window.crypto?.randomUUID?.() || String(Date.now() + Math.random());
      blocks.splice(index + 1, 0, clone);
      selectedBlockId = clone.id;
      renderBuilder();
      scheduleBuilderSave();
    }

    function deleteSelectedBlock() {
      const site = activeBuilderSite;
      if (!site) return;
      site.pages[0].blocks = getSiteBlocks(site).filter(block => block.id !== selectedBlockId);
      selectedBlockId = "";
      renderBuilder();
      scheduleBuilderSave();
    }

    // These helpers create the dashboard cards for saved sites and templates.
    // The dashboard is the landing page the user sees after signing in.
    function siteCard(site) {
      return `
        <article class="site-card">
          <div class="site-information">
            <div><h3>${escapeHtml(site.title)}</h3></div>
            <div class="site-buttons">
              <button class="button-secondary" type="button" data-action="edit-site" data-site-id="${escapeHtml(site.id)}">Edit</button>
              <button class="button-primary" type="button" data-action="preview-site" data-site-id="${escapeHtml(site.id)}">Preview</button>
            </div>
          </div>
        </article>`;
    }

    function templateCards() {
      return TEMPLATE_OPTIONS.map(template => `
        <article class="template-card">
          <div class="template-card-copy"><h3>${template.name}</h3>
            <button class="button-primary" type="button" data-action="use-template" data-template="${template.id}">Use template</button>
          </div>
        </article>`).join("");
    }

    function showDashboardView(view = "dashboard") {
      const content = document.getElementById("dashboardContent");
      const user = getSignedInUser();
      if (!user || !content) return;
      document.getElementById("builderEditor").hidden = true;
      document.querySelector(".dashboard-topbar").hidden = false;
      content.hidden = false;
      document.querySelectorAll(".sidebar-button").forEach(button => {
        button.classList.toggle("active", button.dataset.view === view);
      });
      const sites = getSites().sort((first, second) => second.updatedAt - first.updatedAt);

      if (view === "sites") {
        content.innerHTML = `<div class="section-heading"><div><h2>My Sites</h2></div><button class="button-primary" type="button" data-action="create-site">＋ Create site</button></div><div class="site-grid">${sites.map(siteCard).join("")}</div>`;
      } else if (view === "templates") {
        content.innerHTML = `<div class="section-heading"><div><h2>Choose a template</h2></div></div><div class="template-grid">${templateCards()}</div>`;
      } else if (view === "resources") {
        content.innerHTML = `<div class="section-heading"><div><h2>Resources</h2></div></div><div class="resource-list"><a href="https://developer.mozilla.org/en-US/docs/Learn/HTML" target="_blank" rel="noreferrer"><span class="resource-mark">01</span><span><strong>HTML basics</strong></span><span aria-hidden="true">↗</span></a><a href="https://developer.mozilla.org/en-US/docs/Learn/CSS" target="_blank" rel="noreferrer"><span class="resource-mark">02</span><span><strong>CSS basics</strong></span><span aria-hidden="true">↗</span></a><a href="https://developer.mozilla.org/en-US/docs/Learn/JavaScript" target="_blank" rel="noreferrer"><span class="resource-mark">03</span><span><strong>JavaScript basics</strong></span><span aria-hidden="true">↗</span></a></div>`;
      } else if (view === "settings") {
        content.innerHTML = `
          <section class="dashboard-section">
            <div class="section-heading">
              <div>
                <h2>Settings</h2>
              </div>
            </div>
            <button class="button-danger" id="deleteAccountButton" type="button" data-action="delete-account">Delete account</button>
            <p class="settings-status" id="deleteAccountStatus" role="status"></p>
          </section>`;
      } else {
        const latestSite = sites[0];
        content.innerHTML = `
          <section class="create-banner"><div><h2>Create a website!</h2></div><button class="button-primary" type="button" data-action="create-site">＋ Create site</button></section>
          <section class="dashboard-section"><div class="section-heading compact"><div><h2>Latest site</h2></div><button class="text-button" type="button" data-view="sites">View all <span aria-hidden="true">→</span></button></div>${latestSite ? siteCard(latestSite) : ""}</section>
          <section class="dashboard-section"><div class="section-heading compact"><div><h2>Start with a template</h2></div><button class="text-button" type="button" data-view="templates">Browse all <span aria-hidden="true">→</span></button></div><div class="template-grid home-templates">${templateCards()}</div></section>`;
      }
    }

    function openSiteDialog(templateId = "blank", siteId = "") {
      // This opens the dialog used to create a brand-new site or rename an existing one.
      const template = TEMPLATE_OPTIONS.find(option => option.id === templateId) || TEMPLATE_OPTIONS[0];
      const site = siteId ? getSites().find(item => item.id === siteId) : null;
      const dialog = document.getElementById("siteDialog");
      document.getElementById("siteDialogTitle").textContent = site ? "Rename your site" : "Create a site";
      document.getElementById("siteNameInput").value = site ? site.title : (template.id === "blank" ? "" : template.name);
      document.getElementById("siteTemplateInput").value = site ? site.template : template.id;
      document.getElementById("siteIdInput").value = site ? site.id : "";
      document.getElementById("siteFormStatus").textContent = "";
      dialog.showModal();
      document.getElementById("siteNameInput").focus();
    }

    function closeSiteDialog() {
      document.getElementById("siteDialog").close();
    }

    function editSite(siteId) {
      openBuilder(siteId);
    }

    // Convert each block into HTML so the preview and export file can be rendered.
    // This is the final website version, separate from the editor canvas.
    function renderBlockHtml(block) {
      const alignment = blockAlignment(block);
      const tone = blockTone(block);
      if (block.type === "heading") return `<h1 class="tone-${tone} align-${alignment}">${escapeHtml(block.content.text || "")}</h1>`;
      if (block.type === "text") return `<p class="tone-${tone} align-${alignment}">${escapeHtml(block.content.text || "")}</p>`;
      if (block.type === "image") {
        const source = safeWebAddress(block.content.src);
        return source ? `<img class="site-image align-${alignment}" src="${escapeHtml(source)}" alt="${escapeHtml(block.content.alt || "")}">` : "";
      }
      if (block.type === "button") {
        const href = safeWebAddress(block.content.href) || "#";
        return `<p class="align-${alignment}"><a class="site-button" href="${escapeHtml(href)}">${escapeHtml(block.content.text || "Button")}</a></p>`;
      }
      return block.type === "divider" ? "<hr>" : "";
    }

    function buildSiteHtml(site) {
      // Build a complete HTML document for the final site preview or export file.
      ensureSitePages(site);
      const title = escapeHtml(site.title || "Untitled site");
      const background = DESIGN_PRESETS.backgrounds[site.design?.background] || DESIGN_PRESETS.backgrounds.paper;
      const font = DESIGN_PRESETS.fonts[site.design?.font] || DESIGN_PRESETS.fonts.serif;
      const pages = site.pages.map((page, index) => ({
        id: `page-${String(page.id || index + 1).replace(/[^A-Za-z0-9_-]/g, "")}`,
        title: page.title || `Page ${index + 1}`,
        content: page.blocks.map(renderBlockHtml).join("\n")
      }));
      const navigation = pages.length > 1
        ? `<nav class="site-nav" aria-label="Pages">${pages.map(page => `<a href="#${escapeHtml(page.id)}">${escapeHtml(page.title)}</a>`).join("")}</nav>`
        : "";
      const pageSections = pages.map(page => `<section class="site-main site-page" id="${escapeHtml(page.id)}"><h1>${escapeHtml(page.title)}</h1>${page.content}</section>`).join("\n");
      return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DynaPuff:wght@400..700&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box}
    body{margin:0;background:${background};color:#25251f;font-family:${font}}
    .site-header{padding:20px 7%;background:#fff}
    .site-nav{display:flex;flex-wrap:wrap;gap:8px 20px;padding:14px 7%;background:#fff;border-top:1px solid #eee}
    .site-nav a{color:#8f3158;font:600 14px ${font};text-decoration:none}
    .site-page{width:min(760px,calc(100% - 40px));min-height:75vh;margin:48px auto;padding:clamp(24px,7vw,72px);background:#fff;scroll-margin-top:24px}
    .site-page h1{font-size:clamp(38px,7vw,72px);line-height:1.05;margin:0 0 24px}
    .site-page p{font-size:18px;line-height:1.7}
    .site-page hr{border:0;border-top:1px solid #dedbd2;margin:28px 0}
    .site-image{display:block;max-width:100%;height:auto;margin:20px auto}
    .align-left{text-align:left}.align-center{text-align:center}.align-right{text-align:right}
    .tone-ink{color:#25251f}.tone-rose{color:#b54270}.tone-moss{color:#3e6e58}
    .site-button{display:inline-block;padding:13px 20px;background:#b54270;color:#fff;text-decoration:none;font:600 15px ${font}}
  </style>
</head>
<body>
  <header class="site-header">${title}</header>
  ${navigation}
  ${pageSections}
</body>
</html>`;
    }

    function previewSite(siteId = activeBuilderSiteId) {
      // Show a modal preview window with the finished website.
      const site = activeBuilderSite?.id === siteId ? activeBuilderSite : getSites().find(item => item.id === siteId);
      if (!site) return;
      document.getElementById("previewDialogTitle").textContent = site.title;
      document.getElementById("sitePreviewFrame").srcdoc = buildSiteHtml(site);
      document.getElementById("sitePreviewDialog").showModal();
    }

    function exportSite() {
      // Download the current site as a standalone HTML file the user can open in a browser.
      const site = activeBuilderSite;
      if (!site) return;
      const blobUrl = URL.createObjectURL(new Blob([buildSiteHtml(site)], { type: "text/html" }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = (site.title || "my-website").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".html";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }

    // Event delegation means we listen once on the document and check what was clicked.
    // This lets the app respond to buttons that are created dynamically after the page loads.
    document.addEventListener("click", event => {
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) {
        event.preventDefault();
        showDashboardView(viewButton.dataset.view);
        return;
      }
      const builderTab = event.target.closest("[data-builder-tab]");
      if (builderTab) {
        activeBuilderTab = builderTab.dataset.builderTab;
        renderBuilder();
        return;
      }
      const pageButton = event.target.closest("[data-page-id]");
      if (pageButton && activeBuilderSite) {
        activeBuilderPageId = pageButton.dataset.pageId;
        selectedBlockId = "";
        renderBuilder();
        return;
      }
      const addBlockButton = event.target.closest("[data-add-block]");
      if (addBlockButton && activeBuilderSiteId) {
        addBuilderBlock(addBlockButton.dataset.addBlock);
        return;
      }
      const actionButton = event.target.closest("[data-action]");
      if (!actionButton) return;
      if (actionButton.dataset.action === "create-site") openSiteDialog();
      if (actionButton.dataset.action === "delete-account") deleteAccount();
      if (actionButton.dataset.action === "use-template") openSiteDialog(actionButton.dataset.template);
      if (actionButton.dataset.action === "edit-site") editSite(actionButton.dataset.siteId);
      if (actionButton.dataset.action === "preview-site") previewSite(actionButton.dataset.siteId);
      if (actionButton.dataset.action === "close-editor") closeBuilder();
      if (actionButton.dataset.action === "add-page") addBuilderPage();
      if (actionButton.dataset.action === "delete-page") deleteBuilderPage();
      if (actionButton.dataset.action === "preview-builder") previewSite();
      if (actionButton.dataset.action === "export-site") exportSite();
      if (actionButton.dataset.action === "close-preview") document.getElementById("sitePreviewDialog").close();
      if (actionButton.dataset.action === "move-block-up") moveSelectedBlock(-1);
      if (actionButton.dataset.action === "move-block-down") moveSelectedBlock(1);
      if (actionButton.dataset.action === "duplicate-block") duplicateSelectedBlock();
      if (actionButton.dataset.action === "delete-block") deleteSelectedBlock();
      if (actionButton.dataset.action === "close-site-dialog") closeSiteDialog();
    });

    document.getElementById("builderCanvas").addEventListener("click", event => {
      const blockElement = event.target.closest("[data-block-id]");
      if (!blockElement) return;
      selectedBlockId = blockElement.dataset.blockId;
      renderBuilder();
    });

    document.getElementById("builderCanvas").addEventListener("keydown", event => {
      const blockElement = event.target.closest("[data-block-id]");
      if (blockElement && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        selectedBlockId = blockElement.dataset.blockId;
        renderBuilder();
      }
    });

    document.getElementById("builderCanvas").addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const blockElement = event.target.closest("[data-block-id]");
      if (!blockElement) return;
      pointerDragBlockId = blockElement.dataset.blockId;
      pointerDragTargetId = "";
      blockElement.classList.add("dragging");
    });

    document.addEventListener("pointermove", event => {
      if (!pointerDragBlockId) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-block-id]");
      document.querySelectorAll(".canvas-block.drop-before, .canvas-block.drop-after").forEach(block => block.classList.remove("drop-before", "drop-after"));
      if (!target || target.dataset.blockId === pointerDragBlockId) {
        pointerDragTargetId = "";
        return;
      }
      pointerDragTargetId = target.dataset.blockId;
      pointerDragAfterTarget = event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
      target.classList.add(pointerDragAfterTarget ? "drop-after" : "drop-before");
    });

    function finishBlockDrag() {
      if (!pointerDragBlockId) return;
      const site = activeBuilderSite;
      const blocks = site ? getSiteBlocks(site) : [];
      const fromIndex = blocks.findIndex(block => block.id === pointerDragBlockId);
      const movedId = pointerDragBlockId;
      if (fromIndex >= 0 && pointerDragTargetId && pointerDragTargetId !== movedId) {
        const [moved] = blocks.splice(fromIndex, 1);
        const targetIndex = blocks.findIndex(block => block.id === pointerDragTargetId);
        if (targetIndex >= 0) {
          blocks.splice(targetIndex + (pointerDragAfterTarget ? 1 : 0), 0, moved);
          selectedBlockId = moved.id;
          renderBuilder();
          scheduleBuilderSave();
        } else {
          blocks.splice(fromIndex, 0, moved);
        }
      }
      pointerDragBlockId = "";
      pointerDragTargetId = "";
      document.querySelectorAll(".canvas-block.dragging, .canvas-block.drop-before, .canvas-block.drop-after").forEach(block => block.classList.remove("dragging", "drop-before", "drop-after"));
    }

    document.addEventListener("pointerup", finishBlockDrag);
    document.addEventListener("pointercancel", finishBlockDrag);

    // While the user types, update the selected block in memory and redraw only the canvas.
    document.getElementById("builderEditor").addEventListener("input", event => {
      const site = activeBuilderSite;
      if (!site) return;
      if (event.target.id === "builderSiteName") {
        site.title = event.target.value.slice(0, 60);
      } else if (event.target.id === "builderPageName") {
        const page = site.pages.find(item => item.id === activeBuilderPageId);
        if (!page) return;
        page.title = event.target.value.slice(0, 40);
        document.getElementById("builderCurrentPageTitle").textContent = page.title.toUpperCase();
      } else if (event.target.dataset.property) {
        const block = getSiteBlocks(site).find(item => item.id === selectedBlockId);
        if (!block) return;
        block.content[event.target.dataset.property] = event.target.value;
        renderCanvasOnly(site);
      } else {
        return;
      }
      scheduleBuilderSave();
    });

    // When a block style changes, update it and re-render the builder.
    document.getElementById("builderEditor").addEventListener("change", event => {
      if (!event.target.dataset.style) return;
      const site = activeBuilderSite;
      const block = site && getSiteBlocks(site).find(item => item.id === selectedBlockId);
      if (!block) return;
      block.style[event.target.dataset.style] = event.target.value;
      renderBuilder();
      scheduleBuilderSave();
    });

    function renderCanvasOnly(site) {
      const blocks = getSiteBlocks(site);
      document.getElementById("builderCanvas").replaceChildren(...blocks.map(makeCanvasBlock));
    }

    // Save new site names and edits when the user submits the site form.
    document.addEventListener("submit", async event => {
      if (event.target.id !== "siteForm") return;
      event.preventDefault();
      const formData = new FormData(event.target);
      const title = formData.get("title").trim();
      const siteId = formData.get("siteId");
      const sites = getSites();
      if (siteId) {
        const site = sites.find(item => item.id === siteId);
        if (!site) return closeSiteDialog();
        site.title = title.slice(0, 60);
        site.updatedAt = Date.now();
      } else {
        const site = makeNewSite(title.slice(0, 60), formData.get("template"));
        sites.push(site);
        try {
          await saveSites(sites);
          closeSiteDialog();
          openBuilder(site.id);
        } catch (error) {
          document.getElementById("siteFormStatus").textContent = `Could not save this site: ${error.message}`;
        }
        return;
      }
      try {
        await saveSites(sites);
        closeSiteDialog();
        showDashboardView("sites");
      } catch (error) {
        document.getElementById("siteFormStatus").textContent = `Could not save this site: ${error.message}`;
      }
    });

    // Account flow: create an account, sign in, sign out, and load the user's profile.
    // These functions talk to Supabase, which stores user data and saved sites securely.
    async function createAccount() {
      const username = document.getElementById("createUsername").value.trim();
      const email = document.getElementById("createEmail").value.trim();
      const password = document.getElementById("createPassword").value;
      const confirmPassword = document.getElementById("confirmPassword").value;
      const error = (text) => setMessage("createMessage", text, "error");

      if (!username || !email || !password || !confirmPassword) return error("Please fill in every box.");
      if (!isValidUsername(username)) return error("That username is not valid.");
      if (!isValidEmail(email)) return error("Please enter a valid email address.");
      if (password.length < 8) return error("Password must be at least 8 characters.");
      if (password !== confirmPassword) return error("The passwords do not match.");
      if (!supabase) return error("Supabase is not configured. Add the project settings to .env.local and restart the app.");

      try {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.toLowerCase(),
          password,
          options: {
            data: { username },
            emailRedirectTo: window.location.origin
          }
        });
        if (signUpError) throw signUpError;
        ["createUsername", "createEmail", "createPassword", "confirmPassword"].forEach(id => document.getElementById(id).value = "");
        if (data.session && data.user) {
          await loadSignedInUser(data.user);
          closeCreateAccount();
        } else {
          setMessage("createMessage", "Check your email for a confirmation link, then sign in.", "success");
        }
      } catch (authError) {
        const message = authError.message || "Could not create your account.";
        error(/duplicate|unique|profiles_username/i.test(message) ? "That username is already taken." : message);
      }
    }

    async function signIn() {
      const email = document.getElementById("signinName").value.trim();
      const password = document.getElementById("signinPassword").value;
      const error = (text) => setMessage("signinMessage", text, "error");
      if (!email || !password) return error("Please fill in both boxes.");
      if (!supabase) return error("Supabase is not configured. Add the project settings to .env.local and restart the app.");

      try {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.toLowerCase(),
          password
        });
        if (signInError) throw signInError;
        await loadSignedInUser(data.user);
        closeSignIn();
        document.getElementById("signinName").value = "";
        document.getElementById("signinPassword").value = "";
      } catch (authError) {
        error(authError.message || "Could not sign in.");
      }
    }

    async function signOut() {
      try {
        if (!supabase) throw new Error("Supabase is not configured.");
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        currentUser = null;
        currentSites = [];
        updateSignedInDisplay();
      } catch (error) {
        setAppStatus(`Could not sign out: ${error.message}`);
      }
    }

    async function deleteAccount() {
      const button = document.getElementById("deleteAccountButton");
      const status = document.getElementById("deleteAccountStatus");
      if (!window.confirm("Delete your account and saved sites? This cannot be undone.")) return;
      button.disabled = true;
      status.textContent = "Deleting your account...";

      try {
        if (!supabase) throw new Error("Supabase is not configured.");

        const { error } = await supabase.functions.invoke("delete-acc");
        if (error) throw error;

        const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
        currentUser = null;
        currentSites = [];
        updateSignedInDisplay();

        if (signOutError) {
          setAppStatus(`Your account was deleted, but sign-out failed: ${signOutError.message}`);
        } else {
          setAppStatus("");
        }
      } catch (error) {
        status.textContent = `Could not delete your account: ${error.message}`;
        button.disabled = false;
      }
    }

    async function loadSignedInUser(authUser) {
      // After login, load the matching profile and the saved sites for this user.
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", authUser.id)
        .single();
      if (profileError) {
        if (profileError.code === "PGRST205" || /schema cache|public\.profiles/i.test(profileError.message)) {
          throw new Error("Supabase cannot find public.profiles. Run supabase-github-migration.sql in this project's SQL Editor, then reload the app.");
        }
        if (profileError.code === "PGRST116") {
          throw new Error("Your account profile is missing. Run supabase-github-migration.sql in this project's SQL Editor, then sign in again.");
        }
        throw profileError;
      }

      const { data: rows, error: sitesError } = await supabase
        .from("sites")
        .select("id, title, template, site_data, updated_at")
        .order("updated_at", { ascending: false });
      if (sitesError) {
        if (sitesError.code === "PGRST205" || /schema cache|public\.sites/i.test(sitesError.message)) {
          throw new Error("Supabase cannot find public.sites. Run supabase-github-migration.sql in this project's SQL Editor, then reload the app.");
        }
        throw sitesError;
      }

      currentUser = {
        id: authUser.id,
        email: authUser.email,
        username: profile.username,
      };
      currentSites = rows.map(row => ensureSitePages({
        ...row.site_data,
        id: row.id,
        title: row.title,
        template: row.template,
        updatedAt: Date.parse(row.updated_at) || row.site_data.updatedAt || Date.now()
      }));
      setAppStatus("");
      updateSignedInDisplay();
    }

    function updateSignedInDisplay() {
      // Toggle between the landing page and dashboard depending on whether someone is signed in.
      const signedInUser = getSignedInUser();
      document.getElementById("landingPage").hidden = Boolean(signedInUser);
      document.getElementById("dashboardPage").hidden = !signedInUser;
      document.body.classList.toggle("dashboard-mode", Boolean(signedInUser));
      document.getElementById("dashboardWelcome").textContent = signedInUser ? "Welcome, " + signedInUser.username + "!" : "";
      renderAvatar(document.getElementById("dashboardAvatar"), signedInUser);
      if (signedInUser) showDashboardView("dashboard");
    }

    // Start the app by checking whether the user is already signed in.
    // This runs once when the page loads and sets up the auth listener.
    async function initializeApplication() {
      try {
        if (!supabase) throw new Error("Supabase settings are missing. Copy .env.example to .env.local, add your project URL and publishable key, then restart the app.");
        supabase.auth.onAuthStateChange((_event, session) => {
          window.setTimeout(() => {
            if (!session) {
              currentUser = null;
              currentSites = [];
              updateSignedInDisplay();
            } else if (currentUser?.id !== session.user.id) {
              loadSignedInUser(session.user).catch(error => setAppStatus(`Could not load your account: ${error.message}`));
            }
          }, 0);
        });
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session) {
          await loadSignedInUser(data.session.user);
        } else {
          updateSignedInDisplay();
        }
      } catch (error) {
        setAppStatus(`Supabase setup error: ${error.message}`);
        updateSignedInDisplay();
      } finally {
        document.getElementById("loadingScreen").hidden = true;
      }
    }

    Object.assign(window, {
      openSignIn,
      closeSignIn,
      openCreateAccount,
      closeCreateAccount,
      switchToCreateAccount,
      switchToSignIn,
      signInWithGitHub,
      createAccount,
      signIn,
      signOut
    });

    initializeApplication();
