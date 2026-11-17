#!/usr/bin/env node
// Collects plugin data for one Claude Code scope and prints JSON to stdout.
// Usage: node collect-plugins.mjs --scope user|project|local [--project <dir>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Collected problems (missing or invalid files). The script records them and keeps running.
const warnings = [];
const warn = (msg) => warnings.push(msg);

// Parses --scope and --project. The project path defaults to the current directory.
function parseArgs(argv) {
  const args = { scope: null, project: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scope') args.scope = argv[++i];
    else if (argv[i] === '--project') args.project = argv[++i];
  }
  return args;
}

// Validates the arguments. An invalid scope is the only error that stops the script.
const { scope, project: projectArg } = parseArgs(process.argv.slice(2));
if (!['user', 'project', 'local'].includes(scope)) {
  console.error('Usage: collect-plugins.mjs --scope user|project|local [--project <dir>]');
  process.exit(1);
}

// Base paths used by every later step.
const home = os.homedir();
const claudeDir = path.join(home, '.claude');
const projectPath = path.resolve(projectArg);

// Reads a JSON file. On failure, adds a warning and returns null.
function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    warn(`${label}: ${e.code === 'ENOENT' ? 'file does not exist' : 'invalid JSON'} (${file})`);
    return null;
  }
}

// Reads a text file. Returns null without a warning; the caller decides what to report.
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Reads the "description" key from YAML frontmatter. Supports plain, quoted,
// block (| >) and continued multi-line values.
function frontmatterDescription(file) {
  // Read the file and find the frontmatter block between the two "---" lines.
  const text = readText(file);
  if (text === null) {
    warn(`file does not exist: ${file}`);
    return null;
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) {
    warn(`frontmatter missing: ${file}`);
    return null;
  }
  // Find the line that starts the description key.
  const lines = m[1].split(/\r?\n/);
  const idx = lines.findIndex((l) => /^description\s*:/.test(l));
  if (idx === -1) {
    warn(`description field missing: ${file}`);
    return null;
  }
  // Collect the value: the rest of the first line plus every indented or blank line after it.
  let value = lines[idx].replace(/^description\s*:\s*/, '');
  const block = /^[|>][+-]?$/.test(value.trim());
  const parts = block ? [] : [value];
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].trim() !== '' && !/^\s/.test(lines[i])) break;
    parts.push(lines[i].trim());
  }
  // Join the lines: "|" keeps line breaks, every other form joins with a space.
  value = parts.filter((p) => p !== '').join(block && value.trim().startsWith('|') ? '\n' : ' ').trim();
  // Remove the surrounding quotes.
  const q = value.match(/^(["'])([\s\S]*)\1$/);
  if (q) value = q[2];
  return value || null;
}

// Wraps a single value in an array. Used for fields that accept a string or a list.
function toArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// Lists a directory. Returns null if it cannot be read.
function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

// Resolves skill entries. Each path can be a skill dir (has SKILL.md) or a dir of skill dirs.
function collectSkills(root, custom) {
  const out = [];
  // Use the custom paths from plugin.json, or the default "skills" folder.
  const paths = custom.length ? custom : ['skills'];
  const seen = new Set();
  for (const p of paths) {
    const abs = path.resolve(root, p);
    // Case 1: the path is one skill folder.
    if (fs.existsSync(path.join(abs, 'SKILL.md'))) {
      if (!seen.has(abs)) {
        seen.add(abs);
        out.push({ name: path.basename(abs), description: frontmatterDescription(path.join(abs, 'SKILL.md')) });
      }
      continue;
    }
    // Case 2: the path is a folder that contains skill folders.
    const entries = listDir(abs);
    if (!entries) {
      if (custom.length) warn(`skills folder does not exist: ${abs}`);
      continue;
    }
    for (const e of entries) {
      const file = path.join(abs, e.name, 'SKILL.md');
      if ((e.isDirectory() || e.isSymbolicLink()) && fs.existsSync(file)) {
        out.push({ name: e.name, description: frontmatterDescription(file) });
      }
    }
  }
  return out;
}

// Resolves command and agent entries. Each path can be a .md file or a dir of .md files.
function collectMarkdown(root, custom, defaultDir) {
  const out = [];
  // Use the custom paths from plugin.json, or the default folder.
  const paths = custom.length ? custom : [defaultDir];
  for (const p of paths) {
    const abs = path.resolve(root, p);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      if (custom.length) warn(`path does not exist: ${abs}`);
      continue;
    }
    // Case 1: the path is one .md file.
    if (stat.isFile()) {
      out.push({ name: path.basename(abs, '.md'), description: frontmatterDescription(abs) });
      continue;
    }
    // Case 2: the path is a folder. Walk it and keep the subfolder as a name prefix.
    const walk = (dir, prefix) => {
      for (const e of listDir(dir) || []) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, `${prefix}${e.name}/`);
        else if (e.name.endsWith('.md')) {
          out.push({ name: prefix + e.name.slice(0, -3), description: frontmatterDescription(full) });
        }
      }
    };
    walk(abs, '');
  }
  return out;
}

// Plugin entries in marketplace.json: map name -> { description, category }.
// The cache avoids reading the same marketplace file once per plugin.
const marketplaceCache = new Map();
function loadMarketplace(name, installLocation) {
  if (marketplaceCache.has(name)) return marketplaceCache.get(name);
  const result = new Map();
  if (installLocation) {
    const file = path.join(installLocation, '.claude-plugin', 'marketplace.json');
    const data = readJson(file, `marketplace ${name}`);
    for (const p of data?.plugins || []) {
      result.set(p.name, { description: p.description ?? null, category: p.category ?? null });
    }
  }
  marketplaceCache.set(name, result);
  return result;
}

// Step 1: read enabledPlugins from the settings file of the scope.
// Only keys with the value true are active.
const settingsFile = {
  user: path.join(claudeDir, 'settings.json'),
  project: path.join(projectPath, '.claude', 'settings.json'),
  local: path.join(projectPath, '.claude', 'settings.local.json'),
}[scope];
const settings = readJson(settingsFile, `settings (${scope})`);
const enabledMap = settings?.enabledPlugins || {};
const enabledKeys = Object.keys(enabledMap).filter((k) => enabledMap[k] === true);

// Step 2: read installed_plugins.json and keep, for each plugin, the entry of this scope.
// For project and local, the entry must have the same projectPath as the project.
const installed = readJson(path.join(claudeDir, 'plugins', 'installed_plugins.json'), 'installed_plugins.json');
const installedByKey = new Map(); // key -> entry for this scope
for (const [key, entries] of Object.entries(installed?.plugins || {})) {
  const match = toArray(entries).find((e) => {
    if (e.scope !== scope) return false;
    if (scope === 'user') return true;
    return e.projectPath && path.resolve(e.projectPath) === projectPath;
  });
  if (match) installedByKey.set(key, match);
}

// Step 3: read known_marketplaces.json to find the installLocation of each marketplace.
// This includes local directory marketplaces. If the file is missing, scan the default folder.
let marketplaces = readJson(path.join(claudeDir, 'plugins', 'known_marketplaces.json'), 'known_marketplaces.json');
const marketplaceLocations = {};
if (marketplaces) {
  for (const [name, info] of Object.entries(marketplaces)) marketplaceLocations[name] = info.installLocation;
} else {
  const base = path.join(claudeDir, 'plugins', 'marketplaces');
  for (const e of listDir(base) || []) {
    if (e.isDirectory()) marketplaceLocations[e.name] = path.join(base, e.name);
  }
}

// Step 4: build the data object of one plugin from all the sources above.
function buildPlugin(key, active) {
  // Base fields from the key and from installed_plugins.json.
  const [name, marketplace] = key.split('@');
  const entry = installedByKey.get(key);
  const plugin = {
    key,
    name,
    marketplace: marketplace ?? null,
    active,
    version: entry?.version ?? null,
    installPath: entry?.installPath ?? null,
    scope: entry?.scope ?? null,
    projectPath: entry?.projectPath ?? null,
    description: null,
    category: null,
    skills: [],
    commands: [],
    agents: [],
  };

  if (!entry) warn(`${key}: no entry in installed_plugins.json for scope ${scope}`);

  // Description and category from the marketplace.
  const mkt = marketplace ? loadMarketplace(marketplace, marketplaceLocations[marketplace]) : new Map();
  if (marketplace && !marketplaceLocations[marketplace]) warn(`${key}: marketplace "${marketplace}" not found`);
  const mktEntry = mkt.get(name);
  if (marketplaceLocations[marketplace] && !mktEntry) warn(`${key}: plugin not listed in marketplace.json`);
  plugin.category = mktEntry?.category ?? null;
  plugin.description = mktEntry?.description ?? null;

  // Stop here if the plugin folder is unknown or missing.
  if (!entry?.installPath) return plugin;
  if (!fs.existsSync(entry.installPath)) {
    warn(`${key}: installPath does not exist (${entry.installPath})`);
    return plugin;
  }

  // plugin.json: its description and version replace the marketplace values.
  const manifest = readJson(path.join(entry.installPath, '.claude-plugin', 'plugin.json'), `${key} plugin.json`);
  if (manifest) {
    plugin.description = manifest.description ?? plugin.description;
    plugin.version = plugin.version ?? manifest.version ?? null;
  }
  // Skills, commands and agents. Custom paths from plugin.json replace the default folders.
  const custom = (field) => toArray(manifest?.[field]).filter((v) => typeof v === 'string');
  plugin.skills = collectSkills(entry.installPath, custom('skills'));
  plugin.commands = collectMarkdown(entry.installPath, custom('commands'), 'commands');
  plugin.agents = collectMarkdown(entry.installPath, custom('agents'), 'agents');
  return plugin;
}

// Build the active plugins.
const activePlugins = enabledKeys.map((k) => buildPlugin(k, true));

// Step 5: plugins installed in this scope but not active.
const inactivePlugins = [...installedByKey.keys()]
  .filter((k) => enabledMap[k] !== true)
  .map((k) => buildPlugin(k, false));

// Print the result as JSON on standard output.
console.log(
  JSON.stringify(
    {
      scope,
      projectPath: scope === 'user' ? null : projectPath,
      generatedAt: new Date().toISOString(),
      settingsFile,
      active: activePlugins,
      inactive: inactivePlugins,
      warnings,
    },
    null,
    2,
  ),
);
