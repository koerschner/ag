# ag-remote-copy.sh: push/pull shared by ag-mac and ag-client (sourced, not run).
# The caller defines HOST, q (quote for the remote shell), ssh_ <snippet> (run a snippet on HOST)
# and rsync_ <args...> (rsync that can reach HOST).
#
# push <local> [remote]   remote ends in "/" or is an existing directory: copy into it (default
#                         inbox/from-engine/). Otherwise remote is the exact target path: only its
#                         parent is created, and a directory's contents land at that path (like cp -r).
# pull <remote> [local]   the same rules, mirrored: into ./ by default, else exactly <local>.
# Remote paths are relative to the remote home; a leading ~/ is accepted.

remote_push() {
  local src=${1:?usage: push <local> [remote]} dst=${2:-inbox/from-engine/} mode
  dst=${dst#\~/}
  [[ -e $src ]] || { echo "push: no such file or directory: $src" >&2; return 1; }
  mode=$(ssh_ "d=$(q "$dst"); if [ \"\${d%/}\" != \"\$d\" ] || [ -d \"\$d\" ]; then mkdir -p \"\$d\" && echo into; else mkdir -p \"\$(dirname \"\$d\")\" && echo exact; fi")
  case $mode in
    into)  rsync_ "$src" "$HOST:${dst%/}/" && echo "$HOST:${dst%/}/$(basename "$src")" ;;
    exact) if [[ -d $src ]]; then rsync_ "${src%/}/" "$HOST:$dst/"; else rsync_ "$src" "$HOST:$dst"; fi && echo "$HOST:$dst" ;;
    *) echo "push: could not prepare $HOST:$dst" >&2; return 1 ;;
  esac
}

remote_pull() {
  local src=${1:?usage: pull <remote> [local]} dst=${2:-./}
  src=${src#\~/}
  if [[ $dst == */ || -d $dst ]]; then
    mkdir -p "$dst" && rsync_ "$HOST:$src" "$dst" && echo "${dst%/}/$(basename "$src")"
  else
    mkdir -p "$(dirname "$dst")"
    if ssh_ "[ -d $(q "$src") ]"; then rsync_ "$HOST:${src%/}/" "$dst/"; else rsync_ "$HOST:$src" "$dst"; fi && echo "$dst"
  fi
}
