#!/bin/bash

# handoff.sh
# Gestion des handoffs entre Claude Code et AntiGravity IDE
# Maintient CONTEXT.md à jour pour permettre la continuité du travail

set -e  # Exit on error

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
CONTEXT_FILE="CONTEXT.md"
BACKUP_DIR=".context-backups"

# Fonctions utilitaires
print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_step() {
    echo -e "${CYAN}▸${NC} $1"
}

show_usage() {
    cat << EOF
Usage: $0 <command> [options]

Commands:
  to-antigravity    Prépare le handoff de Claude Code vers AntiGravity
  to-claude         Prépare le handoff d'AntiGravity vers Claude Code
  update            Met à jour CONTEXT.md avec l'état actuel (auto)
  status            Affiche l'état actuel du contexte
  backup            Crée une sauvegarde manuelle de CONTEXT.md
  restore           Restaure la dernière sauvegarde

Options:
  -m, --message     Message personnalisé pour le handoff
  -n, --no-commit   Ne pas commiter automatiquement
  -h, --help        Afficher cette aide

Exemples:
  $0 to-antigravity -m "Limite de tokens atteinte"
  $0 update
  $0 status
  $0 backup

EOF
}

# Vérifier que CONTEXT.md existe
check_context_file() {
    if [ ! -f "$CONTEXT_FILE" ]; then
        print_error "CONTEXT.md n'existe pas dans ce projet"
        echo ""
        print_info "Initialisez d'abord le workflow avec:"
        echo "  ~/Projets/claude-workflow-templates/scripts/init-workflow.sh [template-type]"
        exit 1
    fi
}

# Créer un backup
create_backup() {
    mkdir -p "$BACKUP_DIR"
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local backup_file="$BACKUP_DIR/context_${timestamp}.md"

    cp "$CONTEXT_FILE" "$backup_file"
    print_success "Backup créé: $backup_file"

    # Garder seulement les 10 derniers backups
    ls -t "$BACKUP_DIR"/context_*.md | tail -n +11 | xargs -r rm
}

# Mettre à jour les métadonnées JSON dans CONTEXT.md
update_session_info() {
    local agent=$1
    local timestamp=$(date -Iseconds)
    local session_id=$(date +"%Y-%m-%d-%H%M")
    local branch=$(git branch --show-current 2>/dev/null || echo "unknown")
    local commit=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    local project=$(basename "$(pwd)")

    # Note: On ne peut pas connaître les tokens réels depuis le script
    # Ces valeurs sont indicatives et doivent être mises à jour manuellement par l'agent

    print_step "Mise à jour des métadonnées de session..."

    # Mise à jour simple du champ active_agent et timestamp
    # (Les autres champs doivent être mis à jour par l'agent lui-même)
    sed -i "s/\"active_agent\": \"[^\"]*\"/\"active_agent\": \"$agent\"/" "$CONTEXT_FILE"
    sed -i "s/\"timestamp\": \"[^\"]*\"/\"timestamp\": \"$timestamp\"/" "$CONTEXT_FILE"
    sed -i "s/\"session_id\": \"[^\"]*\"/\"session_id\": \"$session_id\"/" "$CONTEXT_FILE"
    sed -i "s/\"branch\": \"[^\"]*\"/\"branch\": \"$branch\"/" "$CONTEXT_FILE"
    sed -i "s/\"last_commit\": \"[^\"]*\"/\"last_commit\": \"$commit\"/" "$CONTEXT_FILE"
    sed -i "s/\"project_name\": \"[^\"]*\"/\"project_name\": \"$project\"/" "$CONTEXT_FILE"

    # Mise à jour du metadata en bas
    sed -i "s/\"last_updated_by\": \"[^\"]*\"/\"last_updated_by\": \"$agent\"/" "$CONTEXT_FILE"
    sed -i "s/\"last_updated_at\": \"[^\"]*\"/\"last_updated_at\": \"$timestamp\"/" "$CONTEXT_FILE"
}

# Obtenir le statut git
get_git_status() {
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        echo "Non-Git project"
        return
    fi

    local status=$(git status --porcelain)
    local modified_count=$(echo "$status" | grep -c "^ M" || echo "0")
    local added_count=$(echo "$status" | grep -c "^A" || echo "0")
    local deleted_count=$(echo "$status" | grep -c "^D" || echo "0")
    local untracked_count=$(echo "$status" | grep -c "^??" || echo "0")

    echo "Modified: $modified_count | Added: $added_count | Deleted: $deleted_count | Untracked: $untracked_count"
}

# Afficher le statut actuel
show_status() {
    check_context_file

    print_header "État Actuel du Contexte"
    echo ""

    # Extraire des infos du CONTEXT.md
    local active_agent=$(grep -oP '"active_agent":\s*"\K[^"]+' "$CONTEXT_FILE" | head -1)
    local timestamp=$(grep -oP '"timestamp":\s*"\K[^"]+' "$CONTEXT_FILE" | head -1)
    local branch=$(git branch --show-current 2>/dev/null || echo "N/A")
    local project=$(basename "$(pwd)")

    echo "Projet         : $project"
    echo "Branche        : $branch"
    echo "Agent actif    : $active_agent"
    echo "Dernière MAJ   : $timestamp"
    echo ""

    echo "Statut Git     : $(get_git_status)"
    echo ""

    # Compter les handoffs
    local handoff_count=$(grep -oP '"handoff_count":\s*\K\d+' "$CONTEXT_FILE" | head -1)
    echo "Handoffs       : $handoff_count"
    echo ""

    # Afficher les tâches en cours
    print_info "Tâches en cours:"
    grep -A 3 "### Current Work" "$CONTEXT_FILE" | tail -n +2 | head -n 5
    echo ""

    # Backups disponibles
    if [ -d "$BACKUP_DIR" ]; then
        local backup_count=$(ls -1 "$BACKUP_DIR"/context_*.md 2>/dev/null | wc -l)
        print_info "Backups disponibles: $backup_count"
    fi
}

# Handoff vers AntiGravity
handoff_to_antigravity() {
    local message=$1
    local no_commit=$2

    check_context_file

    print_header "Handoff: Claude Code → AntiGravity"
    echo ""

    # Backup
    print_step "Création du backup..."
    create_backup
    echo ""

    # Mise à jour des métadonnées
    update_session_info "antigravity-ide"

    # Incrémenter le compteur de handoffs
    local current_count=$(grep -oP '"handoff_count":\s*\K\d+' "$CONTEXT_FILE" | head -1)
    local new_count=$((current_count + 1))
    sed -i "s/\"handoff_count\": $current_count/\"handoff_count\": $new_count/" "$CONTEXT_FILE"

    print_success "Métadonnées mises à jour"
    echo ""

    # Commit si demandé
    if [ "$no_commit" != "true" ]; then
        print_step "Commit des changements..."
        git add "$CONTEXT_FILE"

        if [ -n "$message" ]; then
            git commit -m "chore: handoff claude→antigravity - $message" || print_warning "Rien à commiter"
        else
            git commit -m "chore: handoff claude→antigravity" || print_warning "Rien à commiter"
        fi
        echo ""
    fi

    print_success "Handoff préparé avec succès"
    echo ""
    print_header "Prochaines Étapes"
    echo ""
    echo "1. Ouvrir AntiGravity IDE dans ce projet"
    echo "2. Pointer AntiGravity vers CONTEXT.md"
    echo "3. Continuer le travail depuis \"Next Steps (Immediate)\""
    echo ""
    print_info "AntiGravity reprendra automatiquement où Claude s'est arrêté"
    echo ""
}

# Handoff vers Claude Code
handoff_to_claude() {
    local message=$1
    local no_commit=$2

    check_context_file

    print_header "Handoff: AntiGravity → Claude Code"
    echo ""

    # Backup
    print_step "Création du backup..."
    create_backup
    echo ""

    # Mise à jour des métadonnées
    update_session_info "claude-code"

    # Incrémenter le compteur de handoffs
    local current_count=$(grep -oP '"handoff_count":\s*\K\d+' "$CONTEXT_FILE" | head -1)
    local new_count=$((current_count + 1))
    sed -i "s/\"handoff_count\": $current_count/\"handoff_count\": $new_count/" "$CONTEXT_FILE"

    print_success "Métadonnées mises à jour"
    echo ""

    # Commit si demandé
    if [ "$no_commit" != "true" ]; then
        print_step "Commit des changements..."
        git add "$CONTEXT_FILE"

        if [ -n "$message" ]; then
            git commit -m "chore: handoff antigravity→claude - $message" || print_warning "Rien à commiter"
        else
            git commit -m "chore: handoff antigravity→claude" || print_warning "Rien à commiter"
        fi
        echo ""
    fi

    print_success "Handoff préparé avec succès"
    echo ""
    print_header "Prochaines Étapes"
    echo ""
    echo "1. Lancer Claude Code:"
    echo "   cd $(pwd)"
    echo "   claude"
    echo ""
    echo "2. Dans Claude Code, dire:"
    echo "   \"Lis CONTEXT.md et continue le travail depuis Next Steps\""
    echo ""
    print_info "Claude reprendra automatiquement le contexte"
    echo ""
}

# Mise à jour simple (utilisé par les hooks)
update_context() {
    check_context_file

    local agent=${1:-"claude-code"}

    # Backup silencieux
    create_backup > /dev/null

    # Mise à jour des métadonnées
    update_session_info "$agent"

    print_success "CONTEXT.md mis à jour"
}

# Restaurer le dernier backup
restore_backup() {
    if [ ! -d "$BACKUP_DIR" ]; then
        print_error "Aucun backup disponible"
        exit 1
    fi

    local latest_backup=$(ls -t "$BACKUP_DIR"/context_*.md | head -1)

    if [ -z "$latest_backup" ]; then
        print_error "Aucun backup trouvé"
        exit 1
    fi

    print_warning "Restauration du backup: $latest_backup"
    cp "$latest_backup" "$CONTEXT_FILE"
    print_success "CONTEXT.md restauré"
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    local command=$1
    shift

    # Parse options
    local message=""
    local no_commit=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            -m|--message)
                message="$2"
                shift 2
                ;;
            -n|--no-commit)
                no_commit=true
                shift
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                print_error "Option inconnue: $1"
                show_usage
                exit 1
                ;;
        esac
    done

    # Exécuter la commande
    case $command in
        to-antigravity)
            handoff_to_antigravity "$message" "$no_commit"
            ;;
        to-claude)
            handoff_to_claude "$message" "$no_commit"
            ;;
        update)
            update_context "claude-code"
            ;;
        status)
            show_status
            ;;
        backup)
            check_context_file
            create_backup
            ;;
        restore)
            restore_backup
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Commande inconnue: $command"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

# Exécuter
main "$@"
