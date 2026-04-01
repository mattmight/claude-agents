const SUBCOMMANDS = [
  "projects",
  "sessions",
  "inspect",
  "status",
  "serve",
  "watch",
  "completions",
];

const GLOBAL_FLAGS = [
  "--claude-dir",
  "--json",
  "--no-color",
  "--verbose",
  "--help",
  "--version",
];

export function generateBashCompletions(): string {
  return `# claude-agents bash completions
# Add to ~/.bashrc: eval "$(claude-agents completions bash)"

_claude_agents_completions() {
  local cur prev commands
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${SUBCOMMANDS.join(" ")}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "\${commands} ${GLOBAL_FLAGS.join(" ")}" -- "\${cur}"))
    return 0
  fi

  case "\${COMP_WORDS[1]}" in
    projects)
      COMPREPLY=($(compgen -W "--active --sort --json --help" -- "\${cur}"))
      ;;
    sessions)
      if [[ "\${cur}" == -* ]]; then
        COMPREPLY=($(compgen -W "--active --latest --limit --sort --since --format --json --help" -- "\${cur}"))
      elif [[ "\${prev}" == "--format" ]]; then
        COMPREPLY=($(compgen -W "table json csv" -- "\${cur}"))
      elif [[ "\${prev}" == "--sort" ]]; then
        COMPREPLY=($(compgen -W "time project status" -- "\${cur}"))
      else
        # Complete project paths dynamically
        local projects
        projects=$(claude-agents projects --json 2>/dev/null | grep '"path"' | sed 's/.*"path": "\\(.*\\)".*/\\1/')
        COMPREPLY=($(compgen -W "\${projects}" -- "\${cur}"))
      fi
      ;;
    inspect)
      # Complete session IDs dynamically
      local sessions
      sessions=$(claude-agents sessions --json --limit 20 2>/dev/null | grep '"id"' | sed 's/.*"id": "\\(.*\\)".*/\\1/')
      COMPREPLY=($(compgen -W "\${sessions}" -- "\${cur}"))
      ;;
    status)
      COMPREPLY=($(compgen -W "--watch --interval --json --help" -- "\${cur}"))
      ;;
    serve)
      COMPREPLY=($(compgen -W "--sse --port --help" -- "\${cur}"))
      ;;
    watch)
      COMPREPLY=($(compgen -W "--interval --help" -- "\${cur}"))
      ;;
    completions)
      COMPREPLY=($(compgen -W "bash zsh fish" -- "\${cur}"))
      ;;
  esac
}

complete -F _claude_agents_completions claude-agents
`;
}

export function generateZshCompletions(): string {
  return `#compdef claude-agents
# claude-agents zsh completions
# Add to ~/.zshrc: eval "$(claude-agents completions zsh)"

_claude_agents() {
  local -a commands
  commands=(
    'projects:List all known projects'
    'sessions:List sessions, optionally filtered by project'
    'inspect:Show detailed information about a single session'
    'status:Quick summary dashboard'
    'serve:Start MCP server'
    'watch:Watch for session changes (streaming NDJSON)'
    'completions:Generate shell completions'
  )

  _arguments -C \\
    '--claude-dir[Path to Claude data directory]:path:_files -/' \\
    '--json[Output as JSON]' \\
    '--no-color[Disable color output]' \\
    '--verbose[Include additional metadata]' \\
    '--help[Display help]' \\
    '--version[Display version]' \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[1] in
        projects)
          _arguments \\
            '--active[Only show projects with active sessions]' \\
            '--sort[Sort field]:field:(path last_active session_count)'
          ;;
        sessions)
          _arguments \\
            '--active[Only show active sessions]' \\
            '--latest[Show only the most recent session per project]' \\
            '--limit[Maximum sessions to display]:number' \\
            '--sort[Sort field]:field:(time project status)' \\
            '--since[Only sessions since duration]:duration' \\
            '--format[Output format]:format:(table json csv)' \\
            '1:project path:_files -/'
          ;;
        inspect)
          _arguments '1:session ID:'
          ;;
        status)
          _arguments \\
            '--watch[Re-scan and redraw on interval]' \\
            '--interval[Refresh interval in seconds]:seconds'
          ;;
        serve)
          _arguments \\
            '--sse[Use HTTP+SSE transport]' \\
            '--port[Port for SSE transport]:port'
          ;;
        watch)
          _arguments '--interval[Scan interval in seconds]:seconds'
          ;;
        completions)
          _arguments '1:shell:(bash zsh fish)'
          ;;
      esac
      ;;
  esac
}

_claude_agents
`;
}

export function generateFishCompletions(): string {
  return `# claude-agents fish completions
# Add to fish: claude-agents completions fish | source

# Disable file completions by default
complete -c claude-agents -f

# Subcommands
complete -c claude-agents -n __fish_use_subcommand -a projects -d 'List all known projects'
complete -c claude-agents -n __fish_use_subcommand -a sessions -d 'List sessions'
complete -c claude-agents -n __fish_use_subcommand -a inspect -d 'Show session details'
complete -c claude-agents -n __fish_use_subcommand -a status -d 'Summary dashboard'
complete -c claude-agents -n __fish_use_subcommand -a serve -d 'Start MCP server'
complete -c claude-agents -n __fish_use_subcommand -a watch -d 'Watch for session changes'
complete -c claude-agents -n __fish_use_subcommand -a completions -d 'Generate shell completions'

# Global flags
complete -c claude-agents -l claude-dir -d 'Path to Claude data directory' -r
complete -c claude-agents -l json -d 'Output as JSON'
complete -c claude-agents -l no-color -d 'Disable color output'
complete -c claude-agents -l verbose -d 'Include additional metadata'

# projects
complete -c claude-agents -n '__fish_seen_subcommand_from projects' -l active -d 'Only active projects'
complete -c claude-agents -n '__fish_seen_subcommand_from projects' -l sort -d 'Sort field' -ra 'path last_active session_count'

# sessions
complete -c claude-agents -n '__fish_seen_subcommand_from sessions' -l active -d 'Only active sessions'
complete -c claude-agents -n '__fish_seen_subcommand_from sessions' -l latest -d 'Most recent per project'
complete -c claude-agents -n '__fish_seen_subcommand_from sessions' -l limit -d 'Max sessions' -r
complete -c claude-agents -n '__fish_seen_subcommand_from sessions' -l sort -d 'Sort field' -ra 'time project status'
complete -c claude-agents -n '__fish_seen_subcommand_from sessions' -l since -d 'Duration filter' -r
complete -c claude-agents -n '__fish_seen_subcommand_from sessions' -l format -d 'Output format' -ra 'table json csv'

# status
complete -c claude-agents -n '__fish_seen_subcommand_from status' -l watch -d 'Watch mode'
complete -c claude-agents -n '__fish_seen_subcommand_from status' -l interval -d 'Refresh interval' -r

# serve
complete -c claude-agents -n '__fish_seen_subcommand_from serve' -l sse -d 'HTTP+SSE transport'
complete -c claude-agents -n '__fish_seen_subcommand_from serve' -l port -d 'SSE port' -r

# watch
complete -c claude-agents -n '__fish_seen_subcommand_from watch' -l interval -d 'Scan interval' -r

# completions
complete -c claude-agents -n '__fish_seen_subcommand_from completions' -a 'bash zsh fish' -d 'Shell type'
`;
}
