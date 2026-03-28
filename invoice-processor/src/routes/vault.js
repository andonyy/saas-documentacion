const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

function getVaultPath() {
  return process.env.OBSIDIAN_VAULT_PATH
    ? path.resolve(process.env.OBSIDIAN_VAULT_PATH, '..')
    : path.join(require('os').homedir(), 'ObsidianVault');
}

// GET /api/vault/tree - Arbol completo de archivos con metadata
router.get('/tree', (req, res) => {
  const vaultPath = getVaultPath();
  if (!fs.existsSync(vaultPath)) {
    return res.status(404).json({ error: 'Vault no encontrado' });
  }

  const tree = buildTree(vaultPath, vaultPath);
  res.json(tree);
});

// GET /api/vault/note?path=relative/path.md - Leer una nota
router.get('/note', (req, res) => {
  const notePath = req.query.path;
  if (!notePath) return res.status(400).json({ error: 'Se requiere ?path=' });

  const vaultPath = getVaultPath();
  const fullPath = path.join(vaultPath, notePath);

  // Seguridad: no salir del vault
  if (!fullPath.startsWith(vaultPath)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Nota no encontrada' });
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  res.json({ path: notePath, content });
});

// GET /api/vault/graph - Grafo de relaciones entre notas
router.get('/graph', (req, res) => {
  const vaultPath = getVaultPath();
  if (!fs.existsSync(vaultPath)) {
    return res.status(404).json({ error: 'Vault no encontrado' });
  }

  const notes = getAllNotes(vaultPath, vaultPath);
  const nodes = [];
  const links = [];
  const noteNames = new Map(); // nombre -> path

  // Indexar todas las notas por nombre
  notes.forEach(n => {
    const name = path.basename(n.path, '.md');
    noteNames.set(name, n.path);
    const folder = path.dirname(n.path);
    nodes.push({
      id: n.path,
      name: name,
      folder: folder === '.' ? '' : folder,
      tags: n.tags
    });
  });

  // Encontrar links [[...]]
  notes.forEach(n => {
    const wikilinks = n.content.match(/\[\[([^\]]+)\]\]/g) || [];
    wikilinks.forEach(link => {
      const target = link.slice(2, -2).split('|')[0].trim();
      const targetPath = noteNames.get(target);
      if (targetPath && targetPath !== n.path) {
        links.push({ source: n.path, target: targetPath });
      }
    });
  });

  res.json({ nodes, links });
});

function buildTree(dir, vaultRoot) {
  const items = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(vaultRoot, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      items.push({
        type: 'folder',
        name: entry.name,
        path: relPath,
        children: buildTree(fullPath, vaultRoot)
      });
    } else if (entry.name.endsWith('.md')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const fm = parseFrontmatter(content);
      items.push({
        type: 'file',
        name: entry.name.replace('.md', ''),
        path: relPath,
        tags: fm.tags || [],
        tipo: fm.tipo || '',
        modified: fs.statSync(fullPath).mtime
      });
    }
  }

  return items;
}

function getAllNotes(dir, vaultRoot) {
  const notes = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'));

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      notes.push(...getAllNotes(fullPath, vaultRoot));
    } else if (entry.name.endsWith('.md')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const fm = parseFrontmatter(content);
      notes.push({
        path: path.relative(vaultRoot, fullPath).replace(/\\/g, '/'),
        content,
        tags: fm.tags || []
      });
    }
  }

  return notes;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  match[1].split('\n').forEach(line => {
    const m = line.match(/^(\w[\w_]*)\s*:\s*(.+)/);
    if (m) {
      let val = m[2].trim();
      // Parse arrays [a, b, c]
      if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim());
      } else {
        val = val.replace(/^"(.*)"$/, '$1');
      }
      fm[m[1]] = val;
    }
  });
  return fm;
}

module.exports = router;
