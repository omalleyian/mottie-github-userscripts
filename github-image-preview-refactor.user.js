// ==UserScript==
// @name        GitHub Image Preview (Refactored)
// @version     2.4.0
// @description A userscript that adds clickable image thumbnails
// @license     MIT
// @author      Ian O'Malley
// @namespace   https://github.com/omalleyian
// @match       https://github.com/*
// @run-at      document-idle
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @connect     github.com
// @connect     githubusercontent.com
// @icon        https://github.githubassets.com/pinned-octocat.svg
// @updateURL   https://raw.githubusercontent.com/omalleyian/mottie-github-userscripts/image-preview-fix/github-image-preview-refactor.user.js
// @downloadURL https://raw.githubusercontent.com/omalleyian/mottie-github-userscripts/image-preview-fix/github-image-preview-refactor.user.js
// ==/UserScript==

(() => {
    "use strict";

    // --- Configuration & Styles ---
    const CONFIG = {
        imgExt: /(png|jpg|jpeg|gif|tif|tiff|bmp|webp)$/i,
        svgExt: /svg$/i,
        spinner: "https://github.githubassets.com/images/spinners/octocat-spinner-32.gif",
        // Selectors updated to be slightly more generic where possible to avoid breakage
        selectors: {
            table: "table[aria-labelledby='folders-and-files']",
            row: "tr.react-directory-row",
            link: ".react-directory-filename-cell a, .react-directory-truncate a",
            icon: ".react-directory-filename-column svg",
            branchSelector: "#repos-file-tree button[aria-label*='branch'], #repos-file-tree button[data-hotkey='w']",
            containerHook: "ghmo:container" // Keep support for external loaders
        }
    };

    const ICONS = {
        tiled: `<svg class="octicon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16"><path d="M0 0h7v7H0zM9 9h7v7H9zM9 0h7v7H9zM0 9h7v7H0z"/></svg>`,
        fullWidth: `<svg class="octicon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16"><path d="M0 0h16v7H0zM0 9h16v7H0z"/></svg>`
    };

    GM_addStyle(`
        /* Wrapper States */
        .ghip-wrapper .ghip-content { display: none; }
        .ghip-wrapper.ghip-show-previews > table { display: none; }
        .ghip-wrapper.ghip-show-previews .ghip-preview-grid { display: grid; gap: 16px; padding: 16px; }

        /* Grid Layouts */
        .ghip-wrapper.ghip-tiled .ghip-preview-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
        .ghip-wrapper.ghip-fullw .ghip-preview-grid { grid-template-columns: 1fr; }

        /* Items */
        .ghip-preview-grid { display: none; }
        .ghip-preview-item {
            display: flex; flex-direction: column; align-items: center;
            padding: 16px; border: 1px solid var(--borderColor-default, #d0d7de);
            border-radius: 6px; background: var(--bgColor-default, #ffffff);
            text-align: center; transition: transform 0.2s, box-shadow 0.2s;
        }
        .ghip-preview-item:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
        .ghip-preview-item a { text-decoration: none; color: inherit; display: flex; flex-direction: column; align-items: center; width: 100%; }

        /* Images & Icons */
        .ghip-preview-item .ghip-non-image { height: 80px; width: 80px; margin: 16px 0; }
        .ghip-preview-item .ghip-image-container { width: 100%; display: flex; justify-content: center; align-items: center; margin: 8px 0; }

        /* Tiled Specifics */
        .ghip-wrapper.ghip-tiled .ghip-preview-item .ghip-image-container { height: 150px; }
        .ghip-wrapper.ghip-tiled .ghip-preview-item img:not(.ghip-non-image) { max-height: 150px; max-width: 100%; object-fit: contain; }
        .ghip-wrapper.ghip-tiled .ghip-preview-item:hover img:not(.ghip-non-image) { transform: scale(1.5); transition: transform 0.2s; }

        /* Full Width Specifics */
        .ghip-wrapper.ghip-fullw .ghip-preview-item .ghip-image-container { height: auto; max-height: 400px; }
        .ghip-wrapper.ghip-fullw .ghip-preview-item img:not(.ghip-non-image) { max-height: 400px; max-width: 100%; object-fit: contain; }

        /* Typography & Utils */
        .ghip-preview-item h4 { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; margin: 8px 0; width: 100%; font-size: 14px; font-weight: 600; }
        .ghip-preview-item.ghip-parent-dir { background: var(--bgColor-muted, #f6f8fa); }
        .ghip-preview-item .ghip-up-tree { font-size: 32px; margin: 16px 0; }
        .ghip-wrapper img.error { border: 5px solid red; border-radius: 32px; }
        .gh-img-preview button { cursor: pointer; }
        .gh-img-preview button.selected { background-color: var(--button-primary-bgColor, #1f883d); color: var(--button-primary-fgColor, #ffffff); }
    `);

    // --- State Management ---
    let globalObserver = null;

    // --- Core Logic ---

    function $(selector, el) { return (el || document).querySelector(selector); }
    function $$(selector, el) { return [...(el || document).querySelectorAll(selector)]; }

    function setupWrapper() {
        const table = $(CONFIG.selectors.table);
        if (!table || !table.parentElement) return null;

        table.parentElement.classList.add("ghip-wrapper");

        let grid = $(".ghip-preview-grid", table.parentElement);
        if (!grid) {
            grid = document.createElement("div");
            grid.className = "ghip-preview-grid";
            table.parentElement.appendChild(grid);
        }
        return grid;
    }

    function addToggles() {
        // Prevent duplicate buttons
        if ($(".gh-img-preview") || !$("#repos-file-tree")) return;

        // Try to find the branch selector container to inject buttons
        const branchSelector = $(CONFIG.selectors.branchSelector);
        if (!branchSelector) return;

        const targetContainer = branchSelector.parentElement?.parentElement;
        if (!targetContainer) return;

        const div = document.createElement("div");
        div.className = "BtnGroup ml-auto d-flex gap-1 gh-img-preview";
        const btnClass = `btn BtnGroup-item tooltipped tooltipped-sw pt-0`;

        div.innerHTML = `
            <button type="button" class="ghip-tiled ${btnClass}" aria-label="Show tiled files with image preview">${ICONS.tiled}</button>
            <button type="button" class="ghip-fullw ${btnClass}" aria-label="Show full width files with image preview">${ICONS.fullWidth}</button>
        `;

        targetContainer.appendChild(div);

        // Event Delegation for buttons
        div.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;

            if (btn.classList.contains('ghip-tiled')) openView('tiled', true);
            if (btn.classList.contains('ghip-fullw')) openView('fullw', true);
        });
    }

    function openView(name, isUserClick = false) {
        const grid = setupWrapper(); // Ensure wrapper exists
        if (!grid) return;

        const wrap = $(".ghip-wrapper");
        const btnSelected = $(`.ghip-${name}`);

        // Toggle Off logic
        if (isUserClick && btnSelected && btnSelected.classList.contains("selected")) {
            return showList();
        }

        // Switch View logic
        buildPreviews(wrap, grid);
        updateUI(name);
        GM_setValue("gh-image-preview", name);
    }

    function showList() {
        const wrap = $(".ghip-wrapper");
        if (wrap) wrap.classList.remove("ghip-show-previews", "ghip-tiled", "ghip-fullw");

        $$(".gh-img-preview button").forEach(b => b.classList.remove("selected"));
        GM_setValue("gh-image-preview", "");

        // Cleanup observer when closing view
        if (globalObserver) {
            globalObserver.disconnect();
            globalObserver = null;
        }
    }

    function updateUI(name) {
        const wrap = $(".ghip-wrapper");

        wrap.classList.remove("ghip-show-previews", "ghip-tiled", "ghip-fullw");
        wrap.classList.add("ghip-show-previews", `ghip-${name}`);

        $$(".gh-img-preview button").forEach(b => b.classList.remove("selected"));

        const btn = $(`.ghip-${name}`);
        if (btn) btn.classList.add("selected");
    }

    function buildPreviews(wrap, grid) {
        // Clear existing to avoid appending duplicates
        grid.innerHTML = "";

        const fragment = document.createDocumentFragment();

        // 1. Parent Directory Link
        const upTreeLink = wrap.querySelector("a[data-testid='up-tree']");
        if (upTreeLink) {
            const item = createPreviewItem(upTreeLink.href, "..", "dir", true);
            fragment.appendChild(item);
        }

        // 2. Process File Rows
        const rows = $$(CONFIG.selectors.row, wrap);

        rows.forEach(row => {
            const linkEl = $(CONFIG.selectors.link, row);
            if (!linkEl) return;

            const url = linkEl.href;
            const fileName = linkEl.textContent.trim();
            let type = "other";

            if (CONFIG.imgExt.test(url)) type = "image";
            else if (CONFIG.svgExt.test(url)) type = "svg";

            // For non-images, try to clone the GitHub icon
            let iconHTML = null;
            if (type === "other") {
                const svg = $(CONFIG.selectors.icon, row);
                if (svg) {
                    const clone = svg.cloneNode(true);
                    clone.classList.add("ghip-non-image");
                    iconHTML = clone.outerHTML;
                }
            }

            const item = createPreviewItem(url, fileName, type, false, iconHTML);
            if (item) fragment.appendChild(item);
        });

        grid.appendChild(fragment);
        initSVGObserver();
    }

    function createPreviewItem(url, fileName, type, isParent = false, iconHTML = null) {
        const item = document.createElement("div");
        item.className = "ghip-preview-item";
        if (isParent) item.classList.add("ghip-parent-dir");

        let content = "";

        if (isParent) {
             content = `<a href="${url}"><h4 class="ghip-up-tree">..</h4></a>`;
        } else if (type === "image") {
            content = `
                <a href="${url}">
                    <h4 title="${fileName}">${fileName}</h4>
                    <div class="ghip-image-container">
                        <img src="${url}?raw=true" alt="${fileName}" loading="lazy"/>
                    </div>
                </a>`;
        } else if (type === "svg") {
            const fileKey = url.substring(url.lastIndexOf("/") + 1);
            content = `
                <a href="${url}">
                    <h4 title="${fileName}">${fileName}</h4>
                    <div class="ghip-image-container">
                        <img data-svg-holder="${fileKey}" data-svg-url="${url}" src="${CONFIG.spinner}" alt="${fileName}" />
                    </div>
                </a>`;
        } else if (iconHTML) {
             // Generic file/folder
             content = `
                <a href="${url}">
                    <h4 title="${fileName}">${fileName}</h4>
                    <div class="ghip-image-container">
                        ${iconHTML}
                    </div>
                </a>`;
        }

        if (content) {
            item.innerHTML = content;
            return item;
        }
        return null;
    }

    // --- Optimized Observer Logic ---

    function initSVGObserver() {
        // Disconnect previous observer to prevent leaks
        if (globalObserver) globalObserver.disconnect();

        const imgs = $$("[data-svg-holder]");
        if (imgs.length === 0) return;

        if ("IntersectionObserver" in window) {
            globalObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        fetchSVG(img);
                        observer.unobserve(img); // Stop watching this image
                    }
                });
            }, { rootMargin: "50px" });

            imgs.forEach(img => globalObserver.observe(img));
        } else {
            // Fallback for very old browsers (unlikely needed for GitHub users)
            imgs.forEach(fetchSVG);
        }
    }

    function fetchSVG(img) {
        GM_xmlhttpRequest({
            method: "GET",
            url: img.dataset.svgUrl + "?raw=true",
            onload: response => {
                // Check if image is still in DOM before setting
                if (!document.body.contains(img)) return;

                const abuse = response.responseText.includes("abuse detection");
                if (!abuse) {
                    const encoded = window.btoa(unescape(encodeURIComponent(response.responseText)));
                    img.src = "data:image/svg+xml;base64," + encoded;
                    img.removeAttribute("data-svg-holder");
                } else {
                    img.classList.add("error");
                    img.title = "Rate limit exceeded";
                }
            }
        });
    }

    // --- Initialization ---

    function init() {
        // GitHub uses Turbo/Pjax, so we need to run on navigation events
        setupWrapper();
        addToggles();

        const savedState = GM_getValue("gh-image-preview");
        if (savedState) {
            openView(savedState);
        }
    }

    // Handle Turbo navigation (GitHub's SPA navigation)
    // 'turbo:render' is the modern event, 'pjax:end' is legacy but sometimes still used
    window.addEventListener('turbo:render', init);
    window.addEventListener('pjax:end', init);
    document.addEventListener(CONFIG.selectors.containerHook, init);

    // Initial run
    init();

})();