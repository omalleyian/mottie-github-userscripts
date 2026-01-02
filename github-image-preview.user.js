// ==UserScript==
// @name        GitHub Image Preview
// @version     2.3.0
// @description A userscript that adds clickable image thumbnails
// @license     MIT
// @author      Rob Garrison
// @namespace   https://github.com/Mottie
// @match       https://github.com/*
// @run-at      document-idle
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @connect     github.com
// @connect     githubusercontent.com
// @require     https://greasyfork.org/scripts/28721-mutations/code/mutations.js?version=1108163
// @icon        https://github.githubassets.com/pinned-octocat.svg
// @updateURL   https://raw.githubusercontent.com/Mottie/GitHub-userscripts/master/github-image-preview.user.js
// @downloadURL https://raw.githubusercontent.com/Mottie/GitHub-userscripts/master/github-image-preview.user.js
// @supportURL  https://github.com/Mottie/GitHub-userscripts/issues
// ==/UserScript==

(() => {
	"use strict";

	GM_addStyle(`
		/* Hide preview content by default */
		.ghip-wrapper .ghip-content { 
			display: none; 
		}
		
		/* Hide the table when showing previews */
		.ghip-wrapper.ghip-show-previews > table {
			display: none;
		}
		
		/* Show the preview grid */
		.ghip-wrapper.ghip-show-previews .ghip-preview-grid {
			display: grid;
			gap: 16px;
			padding: 16px;
		}
		
		/* Tiled view: 4 columns grid */
		.ghip-wrapper.ghip-tiled .ghip-preview-grid {
			grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		}
		
		/* Full width view: single column */
		.ghip-wrapper.ghip-fullw .ghip-preview-grid {
			grid-template-columns: 1fr;
		}
		
		/* Preview grid is hidden by default */
		.ghip-preview-grid {
			display: none;
		}
		
		/* Individual preview item */
		.ghip-preview-item {
			display: flex;
			flex-direction: column;
			align-items: center;
			padding: 16px;
			border: 1px solid var(--borderColor-default, #d0d7de);
			border-radius: 6px;
			background: var(--bgColor-default, #ffffff);
			text-align: center;
			transition: transform 0.2s, box-shadow 0.2s;
		}
		
		.ghip-preview-item:hover {
			transform: translateY(-2px);
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		}
		
		.ghip-preview-item a {
			text-decoration: none;
			color: inherit;
			display: flex;
			flex-direction: column;
			align-items: center;
			width: 100%;
		}
		
		/* Style for non-image icons in preview mode */
		.ghip-preview-item svg.ghip-non-image,
		.ghip-preview-item img.ghip-non-image { 
			height: 80px; 
			width: 80px;
			margin: 16px 0;
		}
		
		/* Image container styling */
		.ghip-preview-item .ghip-image-container {
			width: 100%;
			display: flex;
			justify-content: center;
			align-items: center;
			margin: 8px 0;
		}
		
		/* Tiled view images */
		.ghip-wrapper.ghip-tiled .ghip-preview-item .ghip-image-container {
			height: 150px;
		}
		
		.ghip-wrapper.ghip-tiled .ghip-preview-item img:not(.ghip-non-image) {
			max-height: 150px;
			max-width: 100%;
			object-fit: contain;
		}
		
		/* Zoom on hover in tiled view */
		.ghip-wrapper.ghip-tiled .ghip-preview-item:hover img:not(.ghip-non-image) {
			transform: scale(1.5);
			transition: transform 0.2s;
		}
		
		/* Full width view images */
		.ghip-wrapper.ghip-fullw .ghip-preview-item .ghip-image-container {
			height: auto;
			max-height: 400px;
		}
		
		.ghip-wrapper.ghip-fullw .ghip-preview-item img:not(.ghip-non-image) {
			max-height: 400px;
			max-width: 100%;
			object-fit: contain;
		}

		/* File name styling */
		.ghip-preview-item h4 { 
			overflow: hidden; 
			white-space: nowrap;
			text-overflow: ellipsis; 
			margin: 8px 0;
			width: 100%;
			font-size: 14px;
			font-weight: 600;
		}
		
		/* Parent directory link */
		.ghip-preview-item.ghip-parent-dir {
			background: var(--bgColor-muted, #f6f8fa);
		}
		
		.ghip-preview-item .ghip-up-tree {
			font-size: 32px;
			margin: 16px 0;
		}

		.ghip-wrapper img, 
		.ghip-wrapper svg { 
			max-width: 100%; 
		}
		
		.ghip-wrapper img.error { 
			border: 5px solid red;
			border-radius: 32px; 
		}
		
		/* Button styling */
		.gh-img-preview button {
			cursor: pointer;
		}
		
		.gh-img-preview button.selected {
			background-color: var(--button-primary-bgColor, #1f883d);
			color: var(--button-primary-fgColor, #ffffff);
		}
	`);

	// supported img types
	const imgExt = /(png|jpg|jpeg|gif|tif|tiff|bmp|webp)$/i;
	const svgExt = /svg$/i;
	const spinner = "https://github.githubassets.com/images/spinners/octocat-spinner-32.gif";

	const folderIconClasses = `
		.octicon-file-directory,
		.octicon-file-directory-fill,
		.octicon-file-symlink-directory,
		.octicon-file-submodule`;

	const tiled = `
		<svg class="octicon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16">
			<path d="M0 0h7v7H0zM9 9h7v7H9zM9 0h7v7H9zM0 9h7v7H0z"/>
		</svg>`;

	const fullWidth = `
		<svg class="octicon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16">
			<path d="M0 0h16v7H0zM0 9h16v7H0z"/>
		</svg>`;

	function setupWrapper() {
		// Find the table using the aria-labelledby attribute
		const table = $("table[aria-labelledby='folders-and-files']");
		if (table && table.parentElement) {
			table.parentElement.classList.add("ghip-wrapper");
			
			// Create preview grid container if it doesn't exist
			if (!$(".ghip-preview-grid", table.parentElement)) {
				const grid = document.createElement("div");
				grid.className = "ghip-preview-grid";
				table.parentElement.appendChild(grid);
			}
		}
	}

	function addToggles() {
		// Don't add toggles if they already exist or if we're not on a file tree page
		if ($(".gh-img-preview") || !$("#repos-file-tree")) {
			return;
		}
		
		const div = document.createElement("div");
		div.className = "BtnGroup ml-auto gh-img-preview";
		div.style.cssText = "display: flex; gap: 4px; margin-left: auto;";
		div.innerHTML = `
			<button type="button" class="ghip-tiled btn BtnGroup-item" title="Show tiled files with image preview">${tiled}</button>
			<button type="button" class="ghip-fullw btn BtnGroup-item" title="Show full width files with image preview">${fullWidth}</button>
		`;
		
		// Find the container with the branch selector
		const branchSelector = $("#repos-file-tree button[aria-label*='branch'], #repos-file-tree button[data-hotkey='w']");
		
		if (branchSelector) {
			const targetContainer = branchSelector.parentElement.parentElement;
			if (targetContainer) {
				targetContainer.appendChild(div);
			}
		}

		$(".ghip-tiled", div).addEventListener("click", event => {
			openView("tiled", event);
		});
		$(".ghip-fullw", div).addEventListener("click", event => {
			openView("fullw", event);
		});
	}

	function setInitState() {
		const state = GM_getValue("gh-image-preview");
		if (state) {
			// Don't pass event, so the button will be properly selected
			openView(state);
		}
	}

	function openView(name, event) {
		setupWrapper();
		const wrap = $(".ghip-wrapper");
		if (!wrap) {
			return;
		}
		const el = $(".ghip-" + name);
		if (el) {
			if (event) {
				// If clicking the already selected button, deselect it
				if (el.classList.contains("selected")) {
					return showList();
				}
			}
			showPreview(name);
		}
	}

	function showPreview(name) {
		buildPreviews();
		const wrap = $(".ghip-wrapper");
		const selected = "ghip-" + name;
		const notSelected = "ghip-" + (name === "fullw" ? "tiled" : "fullw");
		
		// Remove both view classes first
		wrap.classList.remove("ghip-show-previews", "ghip-tiled", "ghip-fullw");
		$(".btn.ghip-tiled").classList.remove("selected");
		$(".btn.ghip-fullw").classList.remove("selected");
		
		// Add the selected view classes
		wrap.classList.add("ghip-show-previews", selected);
		$(".btn." + selected).classList.add("selected");
		
		GM_setValue("gh-image-preview", name);
	}

	function showList() {
		const wrap = $(".ghip-wrapper");
		wrap.classList.remove("ghip-show-previews", "ghip-tiled", "ghip-fullw");
		$(".btn.ghip-tiled").classList.remove("selected");
		$(".btn.ghip-fullw").classList.remove("selected");
		GM_setValue("gh-image-preview", "");
	}

	function buildPreviews() {
		const wrap = $(".ghip-wrapper");
		if (!wrap) {
			return;
		}
		
		const grid = $(".ghip-preview-grid", wrap);
		if (!grid) {
			return;
		}
		
		// Clear existing previews
		grid.innerHTML = "";
		
		// Find all directory rows in the table
		$$("tr.react-directory-row", wrap).forEach(row => {
			// Find the link
			const linkEl = $(".react-directory-filename-cell a, .react-directory-truncate a", row);
			const url = linkEl ? linkEl.href : "";
			const fileName = linkEl ? linkEl.textContent.trim() : "";
			
			// Check if this is the parent directory link
			const isParentDir = !!row.querySelector('[data-testid="up-tree"]');
			
			// Create preview item
			const item = document.createElement("div");
			item.className = "ghip-preview-item";
			if (isParentDir) {
				item.classList.add("ghip-parent-dir");
			}
			
			let content = "";
			
			if (isParentDir) {
				// Parent directory link
				const upTreeLink = $("a[data-testid='up-tree']", row);
				content = upTreeLink ? 
					`<a href="${upTreeLink.href}"><h4 class="ghip-up-tree">..</h4></a>` : "";
			} else if (imgExt.test(url)) {
				// Image preview
				content = `
					<a href="${url}">
						<h4 title="${fileName}">${fileName}</h4>
						<div class="ghip-image-container">
							<img src="${url}?raw=true" alt="${fileName}"/>
						</div>
					</a>
				`;
			} else if (svgExt.test(url)) {
				// SVG preview
				content = `
					<a href="${url}">
						<h4 title="${fileName}">${fileName}</h4>
						<div class="ghip-image-container">
							${svgPlaceholder(url, fileName)}
						</div>
					</a>
				`;
			} else {
				// Non-images (file/folder icons)
				const svg = $(".react-directory-filename-column svg", row);
				if (svg) {
					const isFolder = svg.matches(folderIconClasses);
					const clone = svg.cloneNode(true);
					clone.classList.add("ghip-non-image");
					
					const link = url ? `<a href="${url}">` : `<span>`;
					const closeLink = url ? `</a>` : `</span>`;
					
					content = `
						${link}
							<h4 title="${fileName}">${fileName}</h4>
							<div class="ghip-image-container ${isFolder ? 'ghip-folder' : ''}">
								${clone.outerHTML}
							</div>
						${closeLink}
					`;
				}
			}
			
			if (content) {
				item.innerHTML = content;
				grid.appendChild(item);
			}
		});
		
		lazyLoadSVGs();
	}

	function svgPlaceholder(url, fileName) {
		const str = url.substring(url.lastIndexOf("/") + 1, url.length);
		return `<img data-svg-holder="${str}" data-svg-url="${url}" alt="${fileName}" src="${spinner}" />`;
	}

	function lazyLoadSVGs() {
		const imgs = $$("[data-svg-holder]");
		if (imgs.length && "IntersectionObserver" in window) {
			let imgObserver = new IntersectionObserver(entries => {
				entries.forEach(entry => {
					if (entry.isIntersecting) {
						const img = entry.target;
						setTimeout(() => {
							const bounds = img.getBoundingClientRect();
							if (bounds.top <= window.innerHeight && bounds.bottom >= 0) {
								getSVG(imgObserver, img);
							}
						}, 300);
					}
				});
			});
			imgs.forEach(img => imgObserver.observe(img));
		}
	}

	function getSVG(observer, img) {
		GM_xmlhttpRequest({
			method: "GET",
			url: img.dataset.svgUrl + "?raw=true",
			onload: response => {
				const url = response.finalUrl;
				const file = url.substring(url.lastIndexOf("/") + 1, url.length);
				const target = $("[data-svg-holder='" + file + "']");
				const resp = response.responseText;
				const abuse = resp.includes("abuse detection");
				
				if (target && !abuse) {
					const encoded = window.btoa(response.responseText);
					target.src = "data:image/svg+xml;base64," + encoded;
					target.title = "";
					target.classList.remove("error");
					observer.unobserve(img);
				} else if (abuse) {
					img.title = "GitHub is reporting that too many images have been loaded at once, please wait";
					img.classList.add("error");
				}
			}
		});
	}

	function $(selector, el) {
		return (el || document).querySelector(selector);
	}
	
	function $$(selector, el) {
		return [...(el || document).querySelectorAll(selector)];
	}

	function init() {
		if ($("table[aria-labelledby='folders-and-files']")) {
			setupWrapper();
			addToggles();
			setTimeout(setInitState, 0);
		}
	}

	document.addEventListener("ghmo:container", init);
	init();
})();