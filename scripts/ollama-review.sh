#!/bin/bash

# ollama-review.sh — Code Review + PR Description via Ollama (qwen3-coder:30b)
# Usage:
#   ./scripts/ollama-review.sh                  → Review du diff courant (staged + unstaged)
#   ./scripts/ollama-review.sh --staged          → Review uniquement des changements staged
#   ./scripts/ollama-review.sh --commit HEAD~1   → Review d'un commit spécifique
#   ./scripts/ollama-review.sh --file path.ts    → Review d'un fichier entier
#   ./scripts/ollama-review.sh --pr              → Générer la description de PR (diff vs main)
#   ./scripts/ollama-review.sh --pr --base main  → Spécifier la branche de base

set -e

# Configuration
MODEL="${OLLAMA_REVIEW_MODEL:-qwen3-coder:30b}"
OLLAMA_URL="${OLLAMA_HOST:-http://localhost:11434}"

# Couleurs
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Vérification Ollama disponible
check_ollama() {
    if ! curl -s "$OLLAMA_URL/api/tags" > /dev/null 2>&1; then
        echo -e "${RED}✗ Ollama non disponible sur $OLLAMA_URL${NC}"
        echo "  Lancez Ollama avec : ollama serve"
        exit 1
    fi
}

# Vérification modèle disponible
check_model() {
    if ! ollama list 2>/dev/null | grep -q "$MODEL"; then
        echo -e "${YELLOW}⚠ Modèle $MODEL non trouvé localement.${NC}"
        echo -e "  Téléchargement avec : ${CYAN}ollama pull $MODEL${NC}"
        echo ""
        echo -e "  Alternatives disponibles (code review) :"
        echo -e "    ${CYAN}qwen3-coder:30b${NC}   — Défaut recommandé"
        echo -e "    ${CYAN}qwen2.5:32b${NC}         — Généraliste polyvalent"
        echo -e "    ${CYAN}deepseek-coder-v2${NC}   — Très performant"
        echo -e "    ${CYAN}codellama:70b${NC}       — Spécialiste C/Python/JS"
        echo ""
        read -p "Continuer quand même avec $MODEL ? (y/N) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Construction du diff selon les arguments
get_diff() {
    local mode="$1"
    local arg="$2"

    case "$mode" in
        --staged)
            git diff --cached
            ;;
        --commit)
            git diff "${arg:-HEAD~1}" HEAD
            ;;
        --file)
            cat "$arg"
            ;;
        --pr)
            git diff "${arg:-main}...HEAD"
            ;;
        *)
            # Par défaut : staged + unstaged (tout ce qui a changé)
            local diff
            diff=$(git diff HEAD 2>/dev/null)
            if [ -z "$diff" ]; then
                diff=$(git diff --cached 2>/dev/null)
            fi
            echo "$diff"
            ;;
    esac
}

# Prompt de description PR
build_pr_prompt() {
    local diff="$1"
    local commits="$2"
    local branch="$3"
    cat << PROMPT
Tu es un développeur senior qui rédige des descriptions de Pull Request claires et utiles.

Ton rôle : expliquer le POURQUOI, pas le QUOI. Le diff parle de lui-même — la description doit apporter ce que le diff ne montre pas.

Règles :
1. Ne résume PAS le diff ligne par ligne.
2. Explique le problème résolu ou le besoin exprimé.
3. Justifie l'approche choisie (pourquoi celle-là et pas une autre ?).
4. Nomme honnêtement les compromis faits.
5. Indique ce qui pourrait être affecté ailleurs dans le système.
6. Sois concis. Pas de remplissage, pas de formules creuses.
7. Rédige en français.

Contexte :
- Branche : $branch
- Commits inclus :
$commits

Diff complet :
---
$diff
---

Génère uniquement le corps de la PR en markdown, avec ces 4 sections exactes :

## Pourquoi ces changements ?

## Approche choisie

## Compromis

## Impact sur le système
PROMPT
}

# Affichage et export de la description PR
display_pr() {
    local body="$1"
    local branch="$2"

    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Description PR — $MODEL${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "$body"
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Sauvegarder dans un fichier temporaire pour gh pr create
    local pr_file="/tmp/pr-body-$(date +%s).md"
    echo "$body" > "$pr_file"

    echo -e "${CYAN}→ Description sauvegardée dans : $pr_file${NC}"
    echo ""
    echo -e "${CYAN}→ Commande suggérée :${NC}"
    echo -e "  ${GREEN}gh pr create --title \"[titre]\" --body \"\$(cat $pr_file)\"${NC}"
    echo ""
    echo -e "  ${YELLOW}Ou pour réviser d'abord :${NC}"
    echo -e "  ${GREEN}gh pr create --title \"[titre]\" --body-file $pr_file${NC}"
    echo ""
}

# Prompt de review
build_prompt() {
    local diff="$1"
    cat << PROMPT
Tu es un expert senior en code review. Ton rôle est d'améliorer la qualité du code, pas de réécrire ce qui fonctionne.

Analyse ce diff et fournis une review structurée. Pour chaque point identifié, utilise ce format :

[CRITIQUE] — Bug potentiel, faille de sécurité, erreur logique
[IMPORTANT] — Problème de performance, design questionnable, dette technique
[MINEUR] — Style, lisibilité, suggestion d'amélioration

Règles de la review :
1. Sois direct et concis. Pas de flatterie, pas de "bon travail".
2. Si tu n'as rien à dire sur une catégorie, ne la mentionne pas.
3. Pour chaque point : localisation → problème → suggestion concrète.
4. Concentre-toi sur l'intention du code, pas sur le style (sauf si c'est bloquant).
5. Si le diff est propre : dis "Rien de significatif à signaler." et arrête-toi.

Diff à analyser :
---
$diff
---

Review :
PROMPT
}

# Affichage du résultat
display_review() {
    local review="$1"
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Code Review — $MODEL${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    # Colorisation des niveaux
    echo "$review" \
        | sed "s/\[CRITIQUE\]/$(printf "${RED}[CRITIQUE]${NC}")/g" \
        | sed "s/\[IMPORTANT\]/$(printf "${YELLOW}[IMPORTANT]${NC}")/g" \
        | sed "s/\[MINEUR\]/$(printf "${GREEN}[MINEUR]${NC}")/g"
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${CYAN}→ Claude Code va maintenant analyser ces suggestions.${NC}"
    echo -e "  Chaque [CRITIQUE] sera traité immédiatement."
    echo -e "  Chaque [IMPORTANT] sera présenté avec son avis."
    echo -e "  Les [MINEUR] seront regroupés pour décision."
    echo ""
}

# Main
main() {
    # Parser les arguments
    local mode=""
    local base_branch="main"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --pr)
                mode="--pr"
                shift
                ;;
            --base)
                base_branch="$2"
                shift 2
                ;;
            --staged|--file|--commit)
                mode="$1"
                shift
                ;;
            *)
                # Argument positionnel (ex: HEAD~1 pour --commit)
                if [ -n "$mode" ]; then
                    local positional_arg="$1"
                fi
                shift
                ;;
        esac
    done

    check_ollama
    check_model

    # Mode PR
    if [ "$mode" = "--pr" ]; then
        echo -e "${CYAN}🤖 Ollama PR Description — $MODEL${NC}"
        echo ""

        local branch
        branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

        echo -e "${BLUE}ℹ Branche : $branch → $base_branch${NC}"
        echo -e "${BLUE}ℹ Collecte du diff et des commits...${NC}"

        local diff
        diff=$(get_diff "--pr" "$base_branch")

        if [ -z "$diff" ]; then
            echo -e "${YELLOW}⚠ Aucune différence avec '$base_branch'.${NC}"
            echo "  Vérifiez que vous avez des commits à merger."
            exit 0
        fi

        local commits
        commits=$(git log "$base_branch"...HEAD --oneline 2>/dev/null)

        local lines
        lines=$(echo "$diff" | wc -l)
        echo -e "${BLUE}ℹ Diff : $lines lignes, commits : $(echo "$commits" | wc -l)${NC}"
        echo -e "${BLUE}ℹ Génération de la description PR...${NC}"
        echo ""

        local prompt
        prompt=$(build_pr_prompt "$diff" "$commits" "$branch")

        local body
        body=$(echo "$prompt" | ollama run "$MODEL" 2>/dev/null)

        display_pr "$body" "$branch"
        return
    fi

    # Mode review (défaut)
    echo -e "${CYAN}🤖 Ollama Code Review — $MODEL${NC}"
    echo ""

    echo -e "${BLUE}ℹ Collecte du diff...${NC}"
    local diff
    diff=$(get_diff "$mode" "${positional_arg:-}")

    if [ -z "$diff" ]; then
        echo -e "${YELLOW}⚠ Aucun changement trouvé.${NC}"
        echo "  Assurez-vous d'avoir des fichiers modifiés (staged ou non)."
        exit 0
    fi

    local lines
    lines=$(echo "$diff" | wc -l)
    echo -e "${BLUE}ℹ Diff : $lines lignes — envoi à Ollama...${NC}"
    echo ""

    local prompt
    prompt=$(build_prompt "$diff")

    local review
    review=$(echo "$prompt" | ollama run "$MODEL" 2>/dev/null)

    display_review "$review"
}

main "$@"
