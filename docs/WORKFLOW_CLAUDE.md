# Template Universal (General)

> Configuration workflow Claude Code adaptable à **tous types de projets**

## 🎯 Objectif

Ce template fournit une configuration agnostique du langage et du framework, compatible avec :

- **Python** (Django, FastAPI, Flask, scripts CLI)
- **JavaScript/TypeScript** (Node.js, React, Vue, Angular, Astro, Next.js, etc.)
- **Rust** (Cargo projects)
- **Go** (modules Go)
- **Java** (Maven, Gradle)
- **DevOps** (Docker, Kubernetes, scripts Bash)
- **Projets hybrides** (fullstack, microservices)

## 📁 Fichiers Inclus

```
.claude/
├── .claude-code.json      # Limitation contexte universelle
├── CLAUDE.md              # Mode architecte avec règles strictes Haiku
└── settings.local.json    # Permissions multi-langages
```

## 🚀 Installation

```bash
cd ~/Projets/votre-projet
~/Projets/claude-workflow-templates/scripts/init-workflow.sh general
```

## ⚙️ Configuration

### `.claude-code.json` - Exclusions Universelles

**Include (source code et configs) :**
- Tous les langages : `*.py`, `*.js`, `*.ts`, `*.rs`, `*.go`, `*.java`, `*.c`, `*.cpp`
- Configurations : `*.yml`, `*.yaml`, `*.json`, `*.toml`, `*.conf`
- Scripts : `*.sh`, `*.sql`
- Documentation : `*.md`, `*.txt`
- Directories : `src/`, `app/`, `lib/`, `components/`, `config/`, `scripts/`, `tests/`

**Exclude (dépendances, build, assets) :**
- **Node.js** : `node_modules/`, `dist/`, `build/`, `.next/`, `.nuxt/`
- **Python** : `venv/`, `.venv/`, `__pycache__/`, `*.pyc`, `.pytest_cache/`
- **Rust** : `target/`
- **Go** : `bin/`, `pkg/`
- **Java** : `out/`, `target/`, `*.class`
- **DevOps** : `logs/`, `volumes/`, `data/`, `backup/`
- **Assets** : `*.png`, `*.jpg`, `*.pdf`, `*.mp4`
- **Secrets** : `.env`, `*.key`, `credentials/`
- **VCS** : `.git/`

### `CLAUDE.md` - Règles Intelligentes

**Nouveautés v1.2 :**

1. **Seuils automatiques pour abonnement Pro (44K tokens/5h) :**
   - **90% (39.6K)** : Avertissement + sauvegarde automatique CONTEXT.md
   - **95% (41.8K)** : Alerte critique + nouvelle sauvegarde

2. **Liste explicite Haiku safe/unsafe :**
   - ✅ **Haiku autorisé** : Recherche, tests simples, documentation, refactoring <50 lignes
   - ❌ **Haiku interdit** : Architecture, logique métier, code critique (auth, paiements), >100 lignes

3. **Mise à jour CONTEXT.md manuelle uniquement** (pas de hook automatique)

4. **Priorité Qualité > Économie**

### `settings.local.json` - Permissions

**Allowed :**
- Git : `git *` (status, commit, push, etc.)
- Package managers : `npm`, `pip`, `cargo`, `go`, `mvn`, `gradle`
- Docker : `docker *`, `docker-compose *`
- Langages : `python`, `node`, `rustc`, `go`, `java`
- Utils : `ls`, `cat`, `grep`, `curl`

**Denied :**
- Destructif : `rm -rf *`, `sudo *`
- Système : `shutdown`, `reboot`, `killall`

**Ask (confirmation requise) :**
- `rm *`, `git reset --hard`, `git push --force`
- Publishing : `npm publish`, `cargo publish`

## 🔄 Handoff Claude ↔ AntiGravity

### Quand Basculer ?

**Seuils pour abonnement Pro (44K tokens) :**
- **0-35K** : ✅ Continue normalement
- **35K-39.6K** : ⚠️ Zone d'attention
- **39.6K (90%)** : Claude sauvegarde auto + alerte
- **41.8K (95%)** : 🔴 Handoff immédiat recommandé

### Comment Basculer ?

```bash
# Dans le terminal (quand Claude t'alerte)
./scripts/handoff.sh to-antigravity -m "Seuil 95% atteint"

# Ouvrir AntiGravity
antigravity ~/Projets/votre-projet

# Dans AntiGravity
"Lis CONTEXT.md et continue depuis Next Steps"
# Recommandé : Utiliser Gemini 3 Pro (gratuit pendant preview)
```

### Retour vers Claude Code

```bash
# Dans AntiGravity, mettre à jour CONTEXT.md d'abord

# Puis dans le terminal
./scripts/handoff.sh to-claude -m "Retour depuis AntiGravity"

# Relancer Claude Code
claude

# Dans Claude Code
"Lis CONTEXT.md et continue le travail"
```

## 💡 Cas d'Usage

### Projet Python CLI (Prospection-Analyse)

```bash
cd ~/Projets/Prospection-Analyse
~/Projets/claude-workflow-templates/scripts/init-workflow.sh general
```

**Résultat :**
- Exclut : `venv/`, `__pycache__/`, `reports/*.pdf`, `logs/`
- Inclut : `*.py`, `requirements.txt`, `README.md`, `analyzers/`, `scripts/`
- Économie : 85-90% contexte (500KB → 50KB)

### Projet DevOps/VPS

```bash
cd ~/Projets/VPS
~/Projets/claude-workflow-templates/scripts/init-workflow.sh general
```

**Résultat :**
- Exclut : `volumes/`, `data/`, `logs/`, `.env`, `*.png`
- Inclut : `docker-compose*.yml`, `Dockerfile`, `caddy/`, `scripts/`, `*.sh`
- Économie : 85-90% contexte

### Projet Fullstack

```bash
cd ~/Projets/mon-fullstack
~/Projets/claude-workflow-templates/scripts/init-workflow.sh general
```

**Résultat :**
- Exclut : `node_modules/`, `venv/`, `dist/`, `build/`, `public/images/`
- Inclut : `src/`, `app/`, `api/`, `*.ts`, `*.py`, `package.json`, `requirements.txt`
- Économie : 85-90% contexte

## 📊 Économies Attendues

### Limitation Contexte

**Sans `.claude-code.json` :**
- Projet moyen : ~500-600 KB (incluant dépendances, assets)
- Tokens : ~200-300K

**Avec `.claude-code.json` :**
- Projet filtré : ~50-75 KB (source + configs uniquement)
- Tokens : ~20-30K
- **Économie : 85-90%**

### Délégation Agents

**Agents Haiku 4.5 (tâches simples) :**
- Coût Haiku 4.5 : $1/M tokens
- Coût Sonnet 4.5 : $3/M tokens
- **Économie : 67% sur tâches déléguées**

**Exemple concret :**
```
Tâche : "Génère des tests pour 4 composants"

Avec Sonnet seul :
- 4 composants × 10K tokens = 40K tokens
- Coût : $0.12

Avec délégation Haiku 4.5 (4 agents parallèles) :
- 4 agents × 10K tokens = 40K tokens Haiku 4.5
- Coût : $0.04
- Économie : $0.08 (67%)
```

## 🎯 Workflow Recommandé

1. **Lancer Claude Code**
   ```bash
   cd ~/Projets/votre-projet
   claude
   ```

2. **Claude délègue automatiquement**
   - Recherches → Agent Explore (Haiku)
   - Tests/docs → Agent Task (Haiku)
   - Architecture → Sonnet (toi)

3. **Surveiller les tokens**
   - `/cost` pour voir les coûts réels de la session
   - `/usage` pour voir le % d'utilisation du plan
   - À 39.6K (90%) : Claude sauvegarde auto + propose `/compact`
   - À 41.8K (95%) : Prépare handoff

4. **Compacter si besoin**
   - `/compact` pour libérer du contexte et repousser le handoff

5. **Handoff si nécessaire**
   ```bash
   ./scripts/handoff.sh to-antigravity
   ```

6. **Continuer dans AntiGravity**
   - Utilise Gemini 3 Pro (gratuit)
   - Lis CONTEXT.md pour reprendre

## 🛠️ Commandes Claude Code Utiles

Ces commandes slash sont disponibles directement dans Claude Code pour optimiser votre workflow :

| Commande | Description |
|----------|-------------|
| `/cost` | Affiche les coûts réels de la session |
| `/usage` | Affiche le % d'utilisation du plan (Pro/Max) |
| `/compact` | Compacte le contexte pour libérer de la mémoire |
| `/context` | Visualise l'usage du contexte actuel |
| `/model` | Vérifie ou change le modèle en cours de session |
| `/rewind` | Annule le dernier échange (utile après un agent insatisfaisant) |
| `/memory` | Édite CLAUDE.md directement |
| `/stats` | Statistiques d'usage pour mesurer le ROI réel |
| `/init` | Initialise la configuration Claude Code |

**Astuce :** Utilisez `/compact` à 90% d'utilisation pour repousser le handoff et continuer à travailler.

## 🚨 Cas Spécifiques

### Si Ton Projet a des Besoins Particuliers

**Exclure des patterns supplémentaires :**

Édite `.claude/.claude-code.json` et ajoute dans `exclude` :
```json
{
  "exclude": [
    "ton-pattern-custom/**/*",
    "*.extension-custom"
  ]
}
```

**Inclure des répertoires spécifiques :**

Ajoute dans `include` :
```json
{
  "include": [
    "ton-repertoire-custom/**/*"
  ]
}
```

### Si Tu as Max5 ou Max20

Édite `.claude/CLAUDE.md` et ajuste les seuils :

**Max5 (88K tokens/5h) :**
- Seuil 90% : 79.2K tokens
- Seuil 95% : 83.6K tokens

**Max20 (220K tokens/5h) :**
- Seuil 90% : 198K tokens
- Seuil 95% : 209K tokens

## 📚 Documentation

**Guides complets :**
- `docs/WORKFLOW_AGENTS_CLAUDE.md` - Guide complet délégation agents
- `docs/HANDOFF_CLAUDE_ANTIGRAVITY.md` - Guide handoff détaillé
- `docs/ECONOMIE_TOKENS.md` - Stratégies optimisation coûts
- `docs/MODE_ARCHITECTE_AUTOMATIQUE.md` - Délégation automatique

**Quick start :**
- `docs/EXEMPLES_AGENTS.md` - Créé automatiquement dans ton projet

## 🎓 Best Practices

1. **Utilise les agents Haiku** pour tâches simples et sûres
2. **Garde Sonnet** pour architecture et code critique
3. **Surveille les tokens** régulièrement
4. **Handoff préventif** : Mieux basculer à 80% que crasher à 100%
5. **Update context** manuellement quand nécessaire
6. **Commits réguliers** : Les handoffs créent des commits git

## ✅ Checklist Post-Installation

Après `init-workflow.sh general`, vérifie :

- [ ] `.claude/.claude-code.json` créé
- [ ] `.claude/CLAUDE.md` créé
- [ ] `.claude/settings.local.json` créé
- [ ] `docs/WORKFLOW_CLAUDE.md` créé (lien symbolique)
- [ ] `docs/EXEMPLES_AGENTS.md` créé
- [ ] Lance `claude` pour tester
- [ ] Vérifie que contexte est limité (charge rapide)

## 🔗 Ressources

- **Repo GitHub** : https://github.com/anthropics/claude-code
- **Docs Claude Code** : https://docs.claude.com/en/docs/claude-code
- **AntiGravity IDE** : https://antigravityide.org

---

**Version :** 1.3.0
**Créé :** 2025-11-20
**Mise à jour :** 2026-02-09
**Auteur :** Olivier
**Compatibilité :** Python, Node.js, Rust, Go, Java, DevOps, Fullstack

🎯 **Objectif : 85-90% d'économie de tokens sans compromis sur la qualité**
