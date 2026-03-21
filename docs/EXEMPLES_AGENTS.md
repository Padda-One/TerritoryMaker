# Exemples d'Utilisation des Agents Claude

## 🎯 Recherche dans le Codebase

### Agent Explore (Haiku)

```
"Agent Explore (Haiku, quick): trouve le fichier de configuration principal"

"Agent Explore (Haiku, medium): liste tous les composants qui utilisent
des props TypeScript"

"Agent Explore (Haiku, very thorough): analyse l'architecture complète
du dossier src/components et identifie les patterns utilisés"
```

## 🔧 Tâches Simples

### Agent Task (Haiku)

```
"Agent Task (Haiku): ajoute des commentaires JSDoc à tous les composants
dans src/components/forms/"

"Agent Task (Haiku): génère des tests Vitest pour utils/validation.ts"

"Lance 3 agents Task (Haiku) EN PARALLÈLE :
- Agent 1: Documente src/components/Header.astro
- Agent 2: Documente src/components/Footer.astro
- Agent 3: Documente src/components/Nav.astro"
```

## 🏗️ Architecture Complexe

### Garder Sonnet

```
"Conçois une architecture pour le système de cache multi-niveaux
avec Redis et fallback local"

"Refactorise le système d'authentification pour supporter OAuth2
et JWT simultanément"
```

## 💡 Astuces

1. **Toujours spécifier le modèle :**
   - ✅ "Agent Explore (Haiku, quick): ..."
   - ❌ "Agent Explore: ..." (risque Sonnet)

2. **Utiliser la parallélisation :**
   - Dire explicitement "EN PARALLÈLE"
   - 3-4 agents max en parallèle

3. **Limiter la portée :**
   - Spécifier les fichiers/dossiers exacts
   - Mieux vaut 3 requêtes ciblées qu'une générale

---

Consultez la documentation complète :
- [Guide Workflow](../../../claude-workflow-templates/docs/WORKFLOW_AGENTS_CLAUDE.md)
- [Économie Tokens](../../../claude-workflow-templates/docs/ECONOMIE_TOKENS.md)
