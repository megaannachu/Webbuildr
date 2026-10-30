import { createClient } from '@supabase/supabase-js';

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const supabase = supabaseUrl && supabasePublishableKey
      ? createClient(supabaseUrl, supabasePublishableKey)
      : null;
    let currentUser = null;
    let currentSites = [];
    let githubAccessToken = null;
    let githubRepositories = [];
    let githubRepositoryPage = 1;
    let githubCurrentRepository = null;
    const TEMPLATE_OPTIONS = [
      { id: "blank", name: "Blank Canvas", description: "A clean page for your own ideas.", color: "mint" },
      { id: "portfolio", name: "Portfolio", description: "Showcase your work and experience.", color: "pink" },
      { id: "studio", name: "Studio", description: "A polished home for a small business.", color: "yellow" }
    ];
    const BLOCK_TONES = ["ink", "rose", "moss"];
    const DESIGN_PRESETS = {
      backgrounds: { paper: "#ffffff", mint: "#e9f6f0", blush: "#fff0f4", butter: "#fff8df" },
      fonts: { serif: "Georgia, serif", sans: "Arial, sans-serif", playful: "'DynaPuff', cursive" }
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

    function show(id) { document.getElementById(id).classList.add("active"); }
    function hide(id) { document.getElementById(id).classList.remove("active"); }
    function openSignIn() { show("signinOverlay"); clearMessage("signinMessage"); }
    function closeSignIn() { hide("signinOverlay"); }
    function openCreateAccount() { show("createAccountOverlay"); clearMessage("createMessage"); }
    function closeCreateAccount() { hide("createAccountOverlay"); }
    function switchToCreateAccount() { closeSignIn(); openCreateAccount(); }
    function switchToSignIn() { closeCreateAccount(); openSignIn(); }

    function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
    function isValidUsername(username) { return /^[A-Za-z0-9_]{3,20}$/.test(username); }

    function setMessage(id, text, type) {
      const message = document.getElementById(id);
      message.textContent = text;
      message.className = "account-message " + type;
    }

    function clearMessage(id) { setMessage(id, "", ""); }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      })[character]);
    }

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

    async function signInWithGitHub(messageId = "signinMessage") {
      if (!supabase) {
        setMessage(messageId, "Supabase is not configured.", "error");
        return;
      }
      try {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "github",
          options: {
            scopes: "repo",
            redirectTo: window.location.origin
          }
        });
        if (error) throw error;
      } catch (error) {
        setMessage(messageId, error.message || "Could not connect to GitHub.", "error");
      }
    }

    async function connectGitHub() {
      if (!supabase || !currentUser) {
        setAppStatus("Sign in before connecting GitHub.");
        return;
      }
      try {
        if (currentUser.hasGithubIdentity) {
          const { error } = await supabase.auth.signInWithOAuth({
            provider: "github",
            options: {
              scopes: "repo",
              redirectTo: window.location.origin
            }
          });
          if (error) throw error;
          return;
        }
        const { error } = await supabase.auth.linkIdentity({
          provider: "github",
          options: {
            scopes: "repo",
            redirectTo: window.location.origin
          }
        });
        if (error) throw error;
      } catch (error) {
        document.getElementById("githubBrowserStatus").textContent = error.message || "Could not connect to GitHub.";
      }
    }

    async function githubApi(path) {
      if (!githubAccessToken) throw new Error("Connect GitHub again to browse your repositories.");
      const response = await fetch(`https://api.github.com${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubAccessToken}`,
          "X-GitHub-Api-Version": "2022-11-28"
        }
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || `GitHub returned HTTP ${response.status}.`);
      }
      return payload;
    }

    function renderGithubRepositories() {
      const container = document.getElementById("githubRepositoryList");
      if (!container) return;
      const search = document.getElementById("githubRepositorySearch").value.trim().toLowerCase();
      const matching = githubRepositories.filter(repository =>
        repository.full_name.toLowerCase().includes(search) ||
        (repository.description || "").toLowerCase().includes(search)
      );
      container.innerHTML = matching.length
        ? matching.map(repository => `
          <button class="github-repository" type="button" data-github-repository="${escapeHtml(repository.full_name)}">
            <span class="github-repository-name">${escapeHtml(repository.full_name)}</span>
            <span class="github-repository-meta">${repository.private ? "Private" : "Public"} · ${escapeHtml(repository.default_branch)}</span>
          </button>`).join("")
        : '<p class="github-browser-status">No repositories match that search.</p>';
      document.getElementById("githubLoadMore").hidden = githubRepositories.length < githubRepositoryPage * 100;
    }

    async function loadGithubRepositories(reset = true) {
      const status = document.getElementById("githubBrowserStatus");
      if (!status) return;
      if (!githubAccessToken) {
        status.textContent = "Connect GitHub to browse your repositories.";
        document.getElementById("githubConnectButton").hidden = false;
        return;
      }
      document.getElementById("githubConnectButton").hidden = true;
      status.textContent = "Loading repositories...";
      try {
        if (reset) {
          githubRepositories = [];
          githubRepositoryPage = 1;
        }
        const page = await githubApi(`/user/repos?sort=updated&per_page=100&page=${githubRepositoryPage}&affiliation=owner,collaborator,organization_member`);
        githubRepositories = githubRepositories.concat(page);
        status.textContent = `${githubRepositories.length} repositories loaded.`;
        renderGithubRepositories();
      } catch (error) {
        status.textContent = error.message;
      }
    }

    async function openGithubRepository(fullName) {
      const [owner, repository] = fullName.split("/");
      if (!owner || !repository) return;
      githubCurrentRepository = { owner, repository, fullName };
      document.getElementById("githubSelectedRepository").textContent = fullName;
      document.getElementById("githubFileBrowser").hidden = false;
      document.getElementById("githubCodeView").hidden = true;
      await loadGithubPath("");
    }

    async function loadGithubPath(path) {
      const list = document.getElementById("githubFileList");
      const status = document.getElementById("githubFileStatus");
      if (!githubCurrentRepository || !list) return;
      list.replaceChildren();
      status.textContent = "Loading files...";
      try {
        const { owner, repository } = githubCurrentRepository;
        const encodedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
        const entries = await githubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}`);
        const files = Array.isArray(entries) ? entries : [entries];
        files.sort((first, second) => first.type === second.type
          ? first.name.localeCompare(second.name)
          : first.type === "dir" ? -1 : 1);
        for (const file of files) {
          if (file.type !== "dir" && file.type !== "file") continue;
          const button = document.createElement("button");
          button.className = "github-file";
          button.type = "button";
          button.dataset.githubPath = file.path;
          button.dataset.githubType = file.type;
          const name = document.createElement("span");
          name.className = "github-repository-name";
          name.textContent = `${file.type === "dir" ? "📁" : "📄"} ${file.name}`;
          button.append(name);
          if (file.type === "file") {
            const size = document.createElement("span");
            size.className = "github-file-meta";
            size.textContent = `${file.size} bytes`;
            button.append(size);
          }
          list.append(button);
        }
        const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        if (path) {
          const parent = document.createElement("button");
          parent.className = "github-file";
          parent.type = "button";
          parent.dataset.githubPath = parentPath;
          parent.dataset.githubType = "dir";
          parent.textContent = "↑ Parent folder";
          list.prepend(parent);
        }
        status.textContent = `${files.length} items · ${path || "/"}`;
      } catch (error) {
        status.textContent = error.message;
      }
    }

    function decodeGithubFile(content) {
      const binary = atob(content.replace(/\s/g, ""));
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }

    async function openGithubFile(path) {
      if (!githubCurrentRepository) return;
      const status = document.getElementById("githubFileStatus");
      const codeView = document.getElementById("githubCodeView");
      status.textContent = "Loading file...";
      try {
        const { owner, repository } = githubCurrentRepository;
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        const file = await githubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}`);
        if (file.encoding !== "base64" || !file.content) {
          throw new Error("This file is too large or cannot be displayed. Open it on GitHub instead.");
        }
        document.getElementById("githubCodePath").textContent = `${repository}/${path}`;
        document.getElementById("githubCodeContent").textContent = decodeGithubFile(file.content);
        document.getElementById("githubCodeLink").href = file.html_url;
        codeView.hidden = false;
        status.textContent = "";
      } catch (error) {
        status.textContent = error.message;
      }
    }

    async function copyGithubCode() {
      const code = document.getElementById("githubCodeContent").textContent;
      try {
        await navigator.clipboard.writeText(code);
        document.getElementById("githubCopyStatus").textContent = "Copied. Paste it into your code editor.";
      } catch (error) {
        document.getElementById("githubCopyStatus").textContent = `Could not copy code: ${error.message}`;
      }
    }

    function renderGithubBrowser() {
      const status = document.getElementById("githubBrowserStatus");
      if (!status) return;
      document.getElementById("githubConnectButton").hidden = Boolean(githubAccessToken);
      if (githubAccessToken) loadGithubRepositories();
      else status.textContent = "Connect GitHub to browse private and public repositories.";
    }

    function getSignedInUser() { return currentUser; }

    function getSites() { return currentSites; }

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

    function createId() {
      if (window.crypto?.randomUUID) return window.crypto.randomUUID();
      const bytes = window.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    function makeBlock(type, content = {}) {
      const defaults = {
        heading: { text: "Placeholder text" },
        text: { text: "Placeholder text" },
        image: { src: "", alt: "" },
        button: { text: "Placeholder text", href: "#" },
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
      if (template === "portfolio") return [
        makeBlock("heading", { text: "Placeholder text" }),
        makeBlock("text", { text: "Placeholder text" }),
        makeBlock("button", { text: "Placeholder text", href: "#" })
      ];
      if (template === "studio") return [
        makeBlock("heading", { text: "Placeholder text" }),
        makeBlock("text", { text: "Placeholder text" }),
        makeBlock("button", { text: "Placeholder text", href: "mailto:hello@example.com" })
      ];
      return [];
    }

    function ensureSitePages(site) {
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
      const page = site.pages.find(item => item.id === activeBuilderPageId) || site.pages[0];
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
      return BLOCK_TONES.includes(block.style?.tone) ? block.style.tone : "ink";
    }

    function blockAlignment(block) {
      return ["left", "center", "right"].includes(block.style?.align) ? block.style.align : "left";
    }

    function safeWebAddress(value) {
      const address = String(value || "").trim();
      return /^(https?:|mailto:|tel:|#)/i.test(address) ? address : "";
    }

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
          content.textContent = "Add an image URL in block settings";
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

    function renderBuilder() {
      const site = activeBuilderSite;
      if (!site) return closeBuilder();
      const blocks = getSiteBlocks(site);
      const canvas = document.getElementById("builderCanvas");
      canvas.replaceChildren(...blocks.map(makeCanvasBlock));
      canvas.style.backgroundColor = DESIGN_PRESETS.backgrounds[site.design.background];
      canvas.style.fontFamily = DESIGN_PRESETS.fonts[site.design.font];
      document.getElementById("builderEmpty").hidden = blocks.length > 0;
      document.getElementById("builderSiteName").value = site.title;
      const page = site.pages.find(item => item.id === activeBuilderPageId);
      document.getElementById("builderCurrentPageTitle").textContent = page.title.toUpperCase();
      renderBuilderPanel(site);
      renderBlockInspector(blocks.find(block => block.id === selectedBlockId));
    }

    function renderBuilderPanel(site) {
      const panel = document.getElementById("builderPanelContent");
      const page = site.pages.find(item => item.id === activeBuilderPageId) || site.pages[0];
      const tabTitles = { pages: "Pages", design: "Design", elements: "Elements" };
      document.querySelectorAll(".builder-tab").forEach(button => {
        const selected = button.dataset.builderTab === activeBuilderTab;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", String(selected));
      });
      document.getElementById("builderPanel").setAttribute("aria-labelledby", `builderTab${activeBuilderTab[0].toUpperCase()}${activeBuilderTab.slice(1)}`);
      if (activeBuilderTab === "pages") {
        panel.innerHTML = `<h2>${tabTitles.pages}</h2><div class="builder-page-list">${site.pages.map(item => `<button class="builder-page-item ${item.id === page.id ? "active" : ""}" type="button" data-page-id="${escapeHtml(item.id)}"><span aria-hidden="true">▧</span><span>${escapeHtml(item.title)}</span></button>`).join("")}</div><button class="builder-add-page" type="button" data-action="add-page">＋ Add page</button><label class="builder-page-name">Page name<input id="builderPageName" maxlength="40" value="${escapeHtml(page.title)}"></label>${site.pages.length > 1 ? '<button class="builder-delete-page" type="button" data-action="delete-page">Delete page</button>' : ""}`;
      } else if (activeBuilderTab === "design") {
        panel.innerHTML = `<h2>${tabTitles.design}</h2><p class="builder-panel-note">Site-wide style</p><label class="builder-page-name">Page background<select data-site-style="background"><option value="paper" ${site.design.background === "paper" ? "selected" : ""}>Paper</option><option value="mint" ${site.design.background === "mint" ? "selected" : ""}>Mint</option><option value="blush" ${site.design.background === "blush" ? "selected" : ""}>Blush</option><option value="butter" ${site.design.background === "butter" ? "selected" : ""}>Butter</option></select></label><label class="builder-page-name">Font<select data-site-style="font"><option value="serif" ${site.design.font === "serif" ? "selected" : ""}>Editorial serif</option><option value="sans" ${site.design.font === "sans" ? "selected" : ""}>Clean sans</option><option value="playful" ${site.design.font === "playful" ? "selected" : ""}>Playful</option></select></label>`;
      } else {
        panel.innerHTML = `<h2>${tabTitles.elements}</h2><p class="builder-panel-note">Add to ${escapeHtml(page.title)}</p><div class="builder-element-list"><button type="button" data-add-block="heading"><span aria-hidden="true">T</span> Heading</button><button type="button" data-add-block="text"><span aria-hidden="true">¶</span> Text</button><button type="button" data-add-block="image"><span aria-hidden="true">▧</span> Image</button><button type="button" data-add-block="button"><span aria-hidden="true">↗</span> Button</button><button type="button" data-add-block="divider"><span aria-hidden="true">―</span> Divider</button></div>`;
      }
    }

    function addBuilderPage() {
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
      const inspector = document.getElementById("builderInspector");
      if (!block) {
        inspector.innerHTML = '<p class="inspector-empty">Select a block on the page to edit it.</p>';
        return;
      }
      const contentField = block.type === "image"
        ? `<label>Image URL<input data-property="src" type="url" value="${escapeHtml(block.content.src || "")}" placeholder="https://example.com/image.jpg"></label><label>Alt text<input data-property="alt" value="${escapeHtml(block.content.alt || "")}" placeholder="Describe the image"></label>`
        : block.type === "divider"
          ? '<p class="inspector-empty">A simple divider between page content.</p>'
          : `<label>${block.type === "heading" ? "Heading" : block.type === "button" ? "Button label" : "Text"}<textarea data-property="text" rows="${block.type === "heading" ? 3 : 5}" maxlength="500">${escapeHtml(block.content.text || "")}</textarea></label>${block.type === "button" ? `<label>Link<input data-property="href" type="url" value="${escapeHtml(block.content.href || "")}" placeholder="https://example.com or #section"></label>` : ""}`;
      inspector.innerHTML = `${contentField}<label>Alignment<select data-style="align"><option value="left" ${blockAlignment(block) === "left" ? "selected" : ""}>Left</option><option value="center" ${blockAlignment(block) === "center" ? "selected" : ""}>Center</option><option value="right" ${blockAlignment(block) === "right" ? "selected" : ""}>Right</option></select></label><label>Color<select data-style="tone"><option value="ink" ${blockTone(block) === "ink" ? "selected" : ""}>Ink</option><option value="rose" ${blockTone(block) === "rose" ? "selected" : ""}>Rose</option><option value="moss" ${blockTone(block) === "moss" ? "selected" : ""}>Moss</option></select></label><div class="inspector-actions"><button class="button-secondary" type="button" data-action="move-block-up">Move up</button><button class="button-secondary" type="button" data-action="move-block-down">Move down</button><button class="button-secondary" type="button" data-action="duplicate-block">Duplicate</button><button class="button-danger" type="button" data-action="delete-block">Delete block</button></div>`;
    }

    function openBuilder(siteId) {
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

    function siteCard(site) {
      return `
        <article class="site-card">
          <div class="site-preview ${escapeHtml(site.template)}" aria-hidden="true">
            <div class="preview-top"></div>
            <div class="preview-content"><i></i><i></i><i></i></div>
          </div>
          <div class="site-information">
            <div><h3>${escapeHtml(site.title)}</h3><p>Saved in your workspace</p></div>
            <div class="site-buttons">
              <button class="button-secondary" type="button" data-action="edit-site" data-site-id="${escapeHtml(site.id)}">Edit</button>
              <button class="button-primary" type="button" data-action="preview-site" data-site-id="${escapeHtml(site.id)}">Preview</button>
            </div>
          </div>
        </article>`;
    }

    function emptySites() {
      return `<div class="empty-state"><span aria-hidden="true">＋</span><h3>Your first site starts here</h3><p>Create a site or pick a template to get your workspace going.</p><button class="button-primary" type="button" data-view="templates">Browse templates</button></div>`;
    }

    function templateCards() {
      return TEMPLATE_OPTIONS.map(template => `
        <article class="template-card ${template.color}">
          <div class="template-art" aria-hidden="true"><span></span><span></span><span></span></div>
          <div class="template-card-copy"><h3>${template.name}</h3><p>${template.description}</p>
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
        content.innerHTML = `<div class="section-heading"><div><p class="eyebrow">YOUR WORK</p><h2>My Sites</h2><p>Everything you have started, in one place.</p></div><button class="button-primary" type="button" data-action="create-site">＋ Create site</button></div><div class="site-grid">${sites.length ? sites.map(siteCard).join("") : emptySites()}</div>`;
      } else if (view === "templates") {
        content.innerHTML = `<div class="section-heading"><div><p class="eyebrow">A HEAD START</p><h2>Choose a template</h2><p>Pick a starting point. You can rename it anytime.</p></div></div><div class="template-grid">${templateCards()}</div>`;
      } else if (view === "github") {
        content.innerHTML = `
          <section class="github-browser">
            <header class="github-browser-toolbar">
              <div><h2>GitHub repositories</h2><p class="github-browser-note">Browse files and copy code into your project. WebBuildr will not change your repositories.</p></div>
              <button class="button-secondary" type="button" data-github-action="refresh">Refresh</button>
            </header>
            <button class="button-primary" id="githubConnectButton" type="button" data-github-action="connect">Connect GitHub</button>
            <p class="github-browser-status" id="githubBrowserStatus" role="status"></p>
            <input class="github-search" id="githubRepositorySearch" type="search" placeholder="Search repositories" aria-label="Search repositories">
            <div class="github-repository-list" id="githubRepositoryList"></div>
            <button class="button-secondary" id="githubLoadMore" type="button" data-github-action="load-more" hidden>Load more repositories</button>
            <section class="github-file-browser" id="githubFileBrowser" hidden>
              <header class="github-file-header"><h3 id="githubSelectedRepository"></h3><button class="button-secondary" type="button" data-github-action="close-repository">Close</button></header>
              <p class="github-browser-status" id="githubFileStatus" role="status"></p>
              <div class="github-file-list" id="githubFileList"></div>
              <section class="github-code-view" id="githubCodeView" hidden>
                <header class="github-code-header">
                  <h3 id="githubCodePath"></h3>
                  <div><a class="button-secondary" id="githubCodeLink" target="_blank" rel="noreferrer">Open on GitHub</a> <button class="button-primary" type="button" data-github-action="copy">Copy code</button></div>
                </header>
                <p class="github-browser-status" id="githubCopyStatus" role="status"></p>
                <pre><code id="githubCodeContent"></code></pre>
              </section>
            </section>
          </section>`;
        renderGithubBrowser();
      } else if (view === "resources") {
        content.innerHTML = `<div class="section-heading"><div><p class="eyebrow">LEARN AND BUILD</p><h2>Resources</h2><p>Helpful references for making the web your own.</p></div></div><div class="resource-list"><a href="https://developer.mozilla.org/en-US/docs/Learn/HTML" target="_blank" rel="noreferrer"><span class="resource-mark">01</span><span><strong>HTML basics</strong><small>Structure pages with headings, links, images, and more.</small></span><span aria-hidden="true">↗</span></a><a href="https://developer.mozilla.org/en-US/docs/Learn/CSS" target="_blank" rel="noreferrer"><span class="resource-mark">02</span><span><strong>CSS basics</strong><small>Style and arrange the content on your pages.</small></span><span aria-hidden="true">↗</span></a><a href="https://developer.mozilla.org/en-US/docs/Learn/JavaScript" target="_blank" rel="noreferrer"><span class="resource-mark">03</span><span><strong>JavaScript basics</strong><small>Add interaction and behavior to a website.</small></span><span aria-hidden="true">↗</span></a></div>`;
      } else if (view === "settings") {
        content.innerHTML = "";
      } else {
        const latestSite = sites[0];
        content.innerHTML = `
          <section class="create-banner"><div><p class="eyebrow">A FRESH START</p><h2>Create something new</h2><p>Start building your next website.</p></div><button class="button-primary" type="button" data-action="create-site">＋ Create site</button></section>
          <section class="dashboard-section"><div class="section-heading compact"><div><p class="eyebrow">RECENTLY UPDATED</p><h2>Latest site</h2></div><button class="text-button" type="button" data-view="sites">View all <span aria-hidden="true">→</span></button></div>${latestSite ? siteCard(latestSite) : emptySites()}</section>
          <section class="dashboard-section"><div class="section-heading compact"><div><p class="eyebrow">GET INSPIRED</p><h2>Start with a template</h2></div><button class="text-button" type="button" data-view="templates">Browse all <span aria-hidden="true">→</span></button></div><div class="template-grid home-templates">${templateCards()}</div></section>`;
      }
    }

    function openSiteDialog(templateId = "blank", siteId = "") {
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

    function renderBlockHtml(block) {
      const alignment = blockAlignment(block);
      const tone = blockTone(block);
      if (block.type === "heading") return `<h1 class="tone-${tone} align-${alignment}">${escapeHtml(block.content.text || "")}</h1>`;
      if (block.type === "text") return `<p class="tone-${tone} align-${alignment}">${escapeHtml(block.content.text || "")}</p>`;
      if (block.type === "image") {
        const source = safeWebAddress(block.contePnt.src);
        return source ? `<img class="site-image align-${alignment}" src="${escapeHtml(source)}" alt="${escapeHtml(block.content.alt || "")}">` : "";
      }
      if (block.type === "button") {
        const href = safeWebAddress(block.content.href) || "#";
        return `<p class="align-${alignment}"><a class="site-button" href="${escapeHtml(href)}">${escapeHtml(block.content.text || "Button")}</a></p>`;
      }
      return block.type === "divider" ? "<hr>" : "";
    }

    function buildSiteHtml(site) {
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
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;background:${background};color:#25251f;font-family:${font}}.site-header{padding:20px 7%;background:#fff}.site-nav{display:flex;flex-wrap:wrap;gap:8px 20px;padding:14px 7%;background:#fff;border-top:1px solid #eee}.site-nav a{color:#8f3158;font:600 14px Arial,sans-serif;text-decoration:none}.site-page{width:min(760px,calc(100% - 40px));min-height:75vh;margin:48px auto;padding:clamp(24px,7vw,72px);background:#fff;scroll-margin-top:24px}.site-page h1{font-size:clamp(38px,7vw,72px);line-height:1.05;margin:0 0 24px}.site-page p{font-size:18px;line-height:1.7}.site-page hr{border:0;border-top:1px solid #dedbd2;margin:28px 0}.site-image{display:block;max-width:100%;height:auto;margin:20px auto}.align-left{text-align:left}.align-center{text-align:center}.align-right{text-align:right}.tone-ink{color:#25251f}.tone-rose{color:#b54270}.tone-moss{color:#3e6e58}.site-button{display:inline-block;padding:13px 20px;background:#b54270;color:#fff;text-decoration:none;font:600 15px Arial,sans-serif}</style></head><body><header class="site-header">${title}</header>${navigation}${pageSections}<\/body></html>`;
    }

    function previewSite(siteId = activeBuilderSiteId) {
      const site = activeBuilderSite?.id === siteId ? activeBuilderSite : getSites().find(item => item.id === siteId);
      if (!site) return;
      document.getElementById("previewDialogTitle").textContent = site.title;
      document.getElementById("sitePreviewFrame").srcdoc = buildSiteHtml(site);
      document.getElementById("sitePreviewDialog").showModal();
    }

    function exportSite() {
      const site = activeBuilderSite;
      if (!site) return;
      const blobUrl = URL.createObjectURL(new Blob([buildSiteHtml(site)], { type: "text/html" }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = (site.title || "my-website").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".html";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }

    document.addEventListener("click", event => {
      const viewButton = event.target.closest("[data-view]");
      if (viewButton) {
        event.preventDefault();
        showDashboardView(viewButton.dataset.view);
        return;
      }
      const repositoryButton = event.target.closest("[data-github-repository]");
      if (repositoryButton) {
        openGithubRepository(repositoryButton.dataset.githubRepository);
        return;
      }
      const fileButton = event.target.closest("[data-github-path]");
      if (fileButton) {
        if (fileButton.dataset.githubType === "dir") loadGithubPath(fileButton.dataset.githubPath);
        else openGithubFile(fileButton.dataset.githubPath);
        return;
      }
      const githubAction = event.target.closest("[data-github-action]");
      if (githubAction) {
        const action = githubAction.dataset.githubAction;
        if (action === "connect") connectGitHub();
        if (action === "refresh") loadGithubRepositories();
        if (action === "load-more") {
          githubRepositoryPage += 1;
          loadGithubRepositories(false);
        }
        if (action === "copy") copyGithubCode();
        if (action === "close-repository") {
          githubCurrentRepository = null;
          document.getElementById("githubFileBrowser").hidden = true;
        }
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

    document.addEventListener("input", event => {
      if (event.target.id === "githubRepositorySearch") renderGithubRepositories();
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

    document.getElementById("builderEditor").addEventListener("change", event => {
      if (event.target.dataset.siteStyle) {
        const site = activeBuilderSite;
        if (!site) return;
        site.design[event.target.dataset.siteStyle] = event.target.value;
        renderBuilder();
        scheduleBuilderSave();
        return;
      }
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
      document.getElementById("builderEmpty").hidden = blocks.length > 0;
    }

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

    async function loadSignedInUser(authUser) {
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
        hasGithubIdentity: (authUser.identities || []).some(identity => identity.provider === "github")
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
      const signedInUser = getSignedInUser();
      document.getElementById("landingPage").hidden = Boolean(signedInUser);
      document.getElementById("dashboardPage").hidden = !signedInUser;
      document.body.classList.toggle("dashboard-mode", Boolean(signedInUser));
      document.getElementById("dashboardWelcome").textContent = signedInUser ? "Welcome, " + signedInUser.username + "!" : "";
      document.getElementById("dashboardUsername").textContent = signedInUser ? signedInUser.username : "";
      renderAvatar(document.getElementById("dashboardAvatar"), signedInUser);
      if (signedInUser) showDashboardView("dashboard");
    }

    async function initializeApplication() {
      try {
        if (!supabase) throw new Error("Supabase settings are missing. Copy .env.example to .env.local, add your project settings, then restart Vite.");
        supabase.auth.onAuthStateChange((_event, session) => {
          githubAccessToken = session?.provider_token || null;
          window.setTimeout(() => {
            if (!session) {
              currentUser = null;
              currentSites = [];
              githubAccessToken = null;
              updateSignedInDisplay();
            } else if (currentUser?.id !== session.user.id) {
              loadSignedInUser(session.user).catch(error => setAppStatus(`Could not load your account: ${error.message}`));
            } else if (document.querySelector('.sidebar-button[data-view="github"].active')) {
              renderGithubBrowser();
            }
          }, 0);
        });
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        githubAccessToken = data.session?.provider_token || null;
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
