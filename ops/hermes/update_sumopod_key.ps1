param(
  [string]$Server = "ubuntu@43.157.212.126",
  [string]$IdentityFile = "$HOME\.ssh\smt.pem"
)

$secureKey = Read-Host "Tempel API key SumoPod baru" -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)

try {
  $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  if ($apiKey -notmatch '^sk-[A-Za-z0-9_-]+$') {
    throw "Format API key tidak valid. Key SumoPod harus diawali sk-."
  }

  $remoteScript = @'
set -eu
IFS= read -r api_key

case "$api_key" in
  sk-*) ;;
  *) echo "Format API key tidak valid." >&2; exit 2 ;;
esac

app_dir=/opt/hermes-cpnsguru
env_file="$app_dir/data/.env"
backup="$env_file.bak.$(date +%Y%m%d%H%M%S)"
temp_file=$(mktemp)

cp "$env_file" "$backup"
awk '!/^OPENAI_API_KEY=/' "$env_file" > "$temp_file"
printf 'OPENAI_API_KEY=%s\n' "$api_key" >> "$temp_file"
chmod 600 "$temp_file"
mv "$temp_file" "$env_file"

if ! (
  set -a
  . "$env_file"
  set +a
  python3 "$app_dir/test_sumopod_tools.py"
); then
  cp "$backup" "$env_file"
  echo "Tes SumoPod gagal. Konfigurasi lama dipulihkan." >&2
  exit 3
fi

cd "$app_dir"
sudo docker compose up -d --force-recreate hermes
sudo docker ps --filter name=hermes-cpnsguru --format '{{.Names}} | {{.Status}}'
echo "API key valid dan Hermes sudah direstart."
'@

  $apiKey | & ssh -o BatchMode=yes -o ConnectTimeout=15 -i $IdentityFile $Server $remoteScript
  if ($LASTEXITCODE -ne 0) {
    throw "Pembaruan VPS gagal dengan exit code $LASTEXITCODE."
  }
} finally {
  if ($keyPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  }
  $apiKey = $null
}
