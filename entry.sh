#!/bin/bash

# Debug

## Steamcmd debugging
if [[ $DEBUG -eq 1 ]] || [[ $DEBUG -eq 3 ]]; then
    STEAMCMD_SPEW="+set_spew_level 4 4"
fi
## CS2 server debugging
if [[ $DEBUG -eq 2 ]] || [[ $DEBUG -eq 3 ]]; then
    CS2_LOG="on"
    CS2_LOG_MONEY=1
    CS2_LOG_DETAIL=3
    CS2_LOG_ITEMS=1
fi

# Create App Dir
mkdir -p "${STEAMAPPDIR}" || true

# Download Updates
if [[ "$STEAMAPPVALIDATE" -eq 1 ]]; then
    VALIDATE="validate"
else
    VALIDATE=""
fi

## SteamCMD can fail to download
## Retry logic
MAX_ATTEMPTS=10
attempt=0
while [[ $steamcmd_rc != 0 ]] && [[ $attempt -lt $MAX_ATTEMPTS ]]; do
    ((attempt+=1))
    if [[ $attempt -gt 1 ]]; then
        echo "Retrying SteamCMD, attempt ${attempt}"
        # NAO removemos o diretorio steamapps entre tentativas: no CS2 (depot de
        # ~71GB) o steamcmd pode falhar no commit final com "0x602 after update
        # job" com os arquivos 99% baixados. Apagar steamapps descartaria TODO o
        # progresso (dados staged em steamapps/downloading) e forçaria um
        # re-download completo. A re-execução retoma da onde parou.
    fi
    eval bash "${STEAMCMDDIR}/steamcmd.sh" "${STEAMCMD_SPEW}"\
                                +force_install_dir "${STEAMAPPDIR}" \
				+login anonymous \
				+app_update "${STEAMAPPID}" "${VALIDATE}"\
				+quit
    steamcmd_rc=$?
done

## Se o steamcmd falhar mas o jogo ja estiver instalado, sobe mesmo assim.
## (update pode falhar por problema na Valve/CDN — p.ex. "Failed to get manifest
## request code"; servidor no build antigo e melhor que servidor fora do ar.)
if [[ $steamcmd_rc != 0 ]]; then
    if [[ -x "${STEAMAPPDIR}/game/bin/linuxsteamrt64/cs2" ]]; then
        echo "AVISO: steamcmd falhou (rc=${steamcmd_rc}), mas instalacao existente encontrada. Subindo no build atual."
    else
        exit $steamcmd_rc
    fi
fi

# FIX: steamclient.so fix
mkdir -p ~/.steam/sdk64
ln -sfT ${STEAMCMDDIR}/linux64/steamclient.so ~/.steam/sdk64/steamclient.so

# FIX: extend linked library search path to include additional libs provided by valve
export LD_LIBRARY_PATH="$LD_LIBRARY_PATH:${STEAMAPPDIR}/bin/linuxsteamrt64"

# Install server.cfg
mkdir -p $STEAMAPPDIR/game/csgo/cfg
cp /etc/server.cfg "${STEAMAPPDIR}"/game/csgo/cfg/server.cfg

# Install GSI config (telemetria -> http://cs2-web-app:3000/api/gsi)
# O token é sincronizado automaticamente do WEBHOOK_SECRET do .env (via compose).
# Evite os caracteres | & \ no segredo — eles quebram o sed de substituição.
if [[ -f /etc/gamestate_integration_custom.cfg ]]; then
    ESCAPED_SECRET=$(printf '%s' "${WEBHOOK_SECRET:-}" | sed -e 's/[&|\\]/\\&/g')
    sed -e "s|{{WEBHOOK_SECRET}}|${ESCAPED_SECRET}|g" \
        /etc/gamestate_integration_custom.cfg \
        > "${STEAMAPPDIR}"/game/csgo/cfg/gamestate_integration_custom.cfg
else
    echo "AVISO: gamestate_integration_custom.cfg não montado em /etc/ — pulando GSI."
fi

# --- CS2WStats: Metamod + CounterStrikeSharp (para radar ao vivo e estatísticas) ---
# Instalação idempotente: baixa e extrai apenas se ainda não existir no volume persistente.
CSSHARP_VERSION="v1.0.372"
MMS_VERSION="2.0.0-git1410"
CSSHARP_VERSION_FILE="${STEAMAPPDIR}/game/csgo/addons/counterstrikesharp/.cs2wstats_version"
MMS_VERSION_FILE="${STEAMAPPDIR}/game/csgo/addons/metamod/.cs2wstats_version"
# Limpeza de versões antigas (detecta via arquivo de versão; sem arquivo = desatualizado)
if [[ ! -f "$CSSHARP_VERSION_FILE" ]] || ! grep -q "$CSSHARP_VERSION" "$CSSHARP_VERSION_FILE" 2>/dev/null; then
    if [[ -d "${STEAMAPPDIR}/game/csgo/addons/counterstrikesharp" || -d "${STEAMAPPDIR}/game/addons/counterstrikesharp" ]]; then
        echo "[CS2WStats] Versão antiga do CounterStrikeSharp detectada, removendo..."
        rm -rf "${STEAMAPPDIR}/game/csgo/addons/counterstrikesharp" "${STEAMAPPDIR}/game/addons/counterstrikesharp"
    fi
fi
if [[ ! -f "$MMS_VERSION_FILE" ]] || ! grep -q "$MMS_VERSION" "$MMS_VERSION_FILE" 2>/dev/null; then
    if [[ -d "${STEAMAPPDIR}/game/csgo/addons/metamod" || -d "${STEAMAPPDIR}/game/addons/metamod" ]]; then
        echo "[CS2WStats] Versão antiga do Metamod detectada, removendo..."
        rm -rf "${STEAMAPPDIR}/game/csgo/addons/metamod" "${STEAMAPPDIR}/game/addons/metamod" "${STEAMAPPDIR}/game/addons/metamod.vdf" "${STEAMAPPDIR}/game/csgo/addons/metamod.vdf" "${STEAMAPPDIR}/game/addons/metamod_x64.vdf" "${STEAMAPPDIR}/game/csgo/addons/metamod_x64.vdf"
    fi
fi
if [[ ! -d "${STEAMAPPDIR}/game/csgo/addons/counterstrikesharp" ]]; then
    echo "[CS2WStats] Instalando CounterStrikeSharp ${CSSHARP_VERSION}..."
    TMP_ZIP=$(mktemp /tmp/cssharp-XXXX.zip)
    if wget -qO "$TMP_ZIP" "https://github.com/roflmuffin/CounterStrikeSharp/releases/download/${CSSHARP_VERSION}/counterstrikesharp-with-runtime-linux-1.0.372.zip"; then
        unzip -o -q "$TMP_ZIP" -d "${STEAMAPPDIR}/game/csgo/"
        # Fallback: alguns zips extraem em game/addons em vez de game/csgo/addons
        if [[ -d "${STEAMAPPDIR}/game/addons/counterstrikesharp" && ! -d "${STEAMAPPDIR}/game/csgo/addons/counterstrikesharp/bin" ]]; then
            mkdir -p "${STEAMAPPDIR}/game/csgo/addons"
            cp -r "${STEAMAPPDIR}/game/addons/counterstrikesharp" "${STEAMAPPDIR}/game/csgo/addons/"
        fi
        # Registra CounterStrikeSharp no Metamod (metaplugins.ini)
        METAPLUGINS="${STEAMAPPDIR}/game/csgo/addons/metamod/metaplugins.ini"
        if [[ -f "$METAPLUGINS" ]] && ! grep -q "counterstrikesharp" "$METAPLUGINS" 2>/dev/null; then
            echo "addons/counterstrikesharp/bin/linuxsteamrt64/counterstrikesharp" >> "$METAPLUGINS"
        fi
        echo "$CSSHARP_VERSION" > "$CSSHARP_VERSION_FILE" 2>/dev/null || true
        echo "[CS2WStats] CounterStrikeSharp instalado."
    else
        echo "[CS2WStats] AVISO: falha ao baixar CounterStrikeSharp"
    fi
    rm -f "$TMP_ZIP"
fi
# Garante registro do CSSharp no Metamod mesmo quando já instalado mas sem entrada (ex.: upgrade)
METAPLUGINS_FIX="${STEAMAPPDIR}/game/csgo/addons/metamod/metaplugins.ini"
if [[ -f "$METAPLUGINS_FIX" ]] && ! grep -q "counterstrikesharp" "$METAPLUGINS_FIX" 2>/dev/null; then
    echo "addons/counterstrikesharp/bin/linuxsteamrt64/counterstrikesharp" >> "$METAPLUGINS_FIX"
    echo "[CS2WStats] Registrado CounterStrikeSharp em metaplugins.ini"
fi
if [[ ! -d "${STEAMAPPDIR}/game/csgo/addons/metamod" ]]; then
    echo "[CS2WStats] Instalando Metamod ${MMS_VERSION}..."
    TMP_TGZ=$(mktemp /tmp/mms-XXXX.tar.gz)
    if wget -qO "$TMP_TGZ" "https://mms.alliedmods.net/mmsdrop/2.0/mmsource-${MMS_VERSION}-linux.tar.gz"; then
        tar -xzf "$TMP_TGZ" -C "${STEAMAPPDIR}/game/csgo/"
        if [[ -d "${STEAMAPPDIR}/game/addons/metamod" && ! -d "${STEAMAPPDIR}/game/csgo/addons/metamod/bin" ]]; then
            mkdir -p "${STEAMAPPDIR}/game/csgo/addons"
            cp -r "${STEAMAPPDIR}/game/addons/metamod" "${STEAMAPPDIR}/game/csgo/addons/"
            cp "${STEAMAPPDIR}/game/addons/metamod.vdf" "${STEAMAPPDIR}/game/csgo/addons/" 2>/dev/null || true
            cp "${STEAMAPPDIR}/game/addons/metamod_x64.vdf" "${STEAMAPPDIR}/game/csgo/addons/" 2>/dev/null || true
        fi
        echo "$MMS_VERSION" > "$MMS_VERSION_FILE" 2>/dev/null || true
        echo "[CS2WStats] Metamod instalado."
    else
        echo "[CS2WStats] AVISO: falha ao baixar Metamod"
    fi
    rm -f "$TMP_TGZ"
fi
# Corrige instalação anterior em game/addons (mover para csgo/addons) se necessário
if [[ -d "${STEAMAPPDIR}/game/addons/counterstrikesharp" && ! -d "${STEAMAPPDIR}/game/csgo/addons/counterstrikesharp/bin" ]]; then
    mkdir -p "${STEAMAPPDIR}/game/csgo/addons"
    cp -r "${STEAMAPPDIR}/game/addons/counterstrikesharp" "${STEAMAPPDIR}/game/csgo/addons/"
fi
if [[ -d "${STEAMAPPDIR}/game/addons/metamod" && ! -d "${STEAMAPPDIR}/game/csgo/addons/metamod/bin" ]]; then
    mkdir -p "${STEAMAPPDIR}/game/csgo/addons"
    cp -r "${STEAMAPPDIR}/game/addons/metamod" "${STEAMAPPDIR}/game/csgo/addons/"
    cp "${STEAMAPPDIR}/game/addons/metamod.vdf" "${STEAMAPPDIR}/game/csgo/addons/" 2>/dev/null || true
    cp "${STEAMAPPDIR}/game/addons/metamod_x64.vdf" "${STEAMAPPDIR}/game/csgo/addons/" 2>/dev/null || true
fi
# Patch gameinfo.gi para carregar metamod (se ainda não estiver) — lida com CRLF e insere ANTES de Game csgo
if [[ -f "${STEAMAPPDIR}/game/csgo/gameinfo.gi" ]] && ! grep -q "addons/metamod" "${STEAMAPPDIR}/game/csgo/gameinfo.gi"; then
    echo "[CS2WStats] Patching gameinfo.gi para Metamod..."
    sed -i 's/\r$//' "${STEAMAPPDIR}/game/csgo/gameinfo.gi"
    awk 'BEGIN{done=0} /Game[[:space:]]+csgo[[:space:]]*$/ && !done {print "\t\tGame\tcsgo/addons/metamod"; done=1} 1' "${STEAMAPPDIR}/game/csgo/gameinfo.gi" > /tmp/gi.new && mv /tmp/gi.new "${STEAMAPPDIR}/game/csgo/gameinfo.gi"
    sed -i 's/$/\r/' "${STEAMAPPDIR}/game/csgo/gameinfo.gi"
fi
# Instala/atualiza o plugin CS2WStats (DLL compilada no host)
if [[ -f /etc/cs2wstats-plugin/CS2WStats.dll ]]; then
    mkdir -p "${STEAMAPPDIR}/game/csgo/addons/counterstrikesharp/plugins/CS2WStats"
    cp /etc/cs2wstats-plugin/CS2WStats.dll "${STEAMAPPDIR}/game/csgo/addons/counterstrikesharp/plugins/CS2WStats/CS2WStats.dll"
    echo "[CS2WStats] Plugin instalado/atualizado."
fi

# Install hooks: o STEAMAPPDIR é um volume persistente (cs2_data) que guarda
# versões antigas dos hooks; copiamos SEMPRE o /etc/*.sh da imagem p/ garantir
# que o pre.sh (copy de addons + patch gameinfo) e o post.sh estejam atualizados.
cp /etc/pre.sh "${STEAMAPPDIR}/pre.sh"
cp /etc/post.sh "${STEAMAPPDIR}/post.sh"

# Download and extract custom config bundle
if [[ ! -z $CS2_CFG_URL ]]; then
    echo "Downloading config pack from ${CS2_CFG_URL}"

    TEMP_DIR=$(mktemp -d)
    TEMP_FILE="${TEMP_DIR}/$(basename ${CS2_CFG_URL})"
    wget -qO "${TEMP_FILE}" "${CS2_CFG_URL}"

    case "${TEMP_FILE}" in
        *.zip)
            echo "Extracting ZIP file..."
            unzip -o -q "${TEMP_FILE}" -d "${STEAMAPPDIR}"
            ;;
        *.tar.gz | *.tgz)
            echo "Extracting TAR.GZ or TGZ file..."
            tar xvzf "${TEMP_FILE}" -C "${STEAMAPPDIR}"
            ;;
        *.tar)
            echo "Extracting TAR file..."
            tar xvf "${TEMP_FILE}" -C "${STEAMAPPDIR}"
            ;;
        *)
            echo "Unsupported file type"
            rm -rf "${TEMP_DIR}"
            exit 1
            ;;
    esac

    rm -rf "${TEMP_DIR}"
fi

# Rewrite Config Files

sed -i -e "s/{{SERVER_HOSTNAME}}/${CS2_SERVERNAME}/g" \
       -e "s/{{SERVER_CHEATS}}/${CS2_CHEATS}/g" \
       -e "s/{{SERVER_HIBERNATE}}/${CS2_SERVER_HIBERNATE}/g" \
       -e "s/{{SERVER_PW}}/${CS2_PW}/g" \
       -e "s/{{SERVER_RCON_PW}}/${CS2_RCONPW}/g" \
       -e "s/{{TV_ENABLE}}/${TV_ENABLE}/g" \
       -e "s/{{TV_PORT}}/${TV_PORT}/g" \
       -e "s/{{TV_AUTORECORD}}/${TV_AUTORECORD}/g" \
       -e "s/{{TV_PW}}/${TV_PW}/g" \
       -e "s/{{TV_RELAY_PW}}/${TV_RELAY_PW}/g" \
       -e "s/{{TV_MAXRATE}}/${TV_MAXRATE}/g" \
       -e "s/{{TV_DELAY}}/${TV_DELAY}/g" \
       -e "s/{{SERVER_LOG}}/${CS2_LOG}/g" \
       -e "s/{{SERVER_LOG_MONEY}}/${CS2_LOG_MONEY}/g" \
       -e "s/{{SERVER_LOG_DETAIL}}/${CS2_LOG_DETAIL}/g" \
       -e "s/{{SERVER_LOG_ITEMS}}/${CS2_LOG_ITEMS}/g" \
       "${STEAMAPPDIR}"/game/csgo/cfg/server.cfg

# Bots removidos — v1.3.0 (blocos de env var removidos)

# Switch to server directory
cd "${STEAMAPPDIR}/game/bin/linuxsteamrt64"

# Pre Hook
source "${STEAMAPPDIR}/pre.sh"

# Construct server arguments

if [[ -z $CS2_GAMEALIAS ]]; then
    # If CS2_GAMEALIAS is undefined then default to CS2_GAMETYPE and CS2_GAMEMODE
    CS2_GAME_MODE_ARGS="+game_type ${CS2_GAMETYPE} +game_mode ${CS2_GAMEMODE}"
else
    # Else, use alias to determine game mode
    CS2_GAME_MODE_ARGS="+game_alias ${CS2_GAMEALIAS}"
fi

if [[ -z $CS2_IP ]]; then
    CS2_IP_ARGS=""
else
    CS2_IP_ARGS="-ip ${CS2_IP}"
fi

if [[ ! -z $SRCDS_TOKEN ]]; then
    SV_SETSTEAMACCOUNT_ARGS="+sv_setsteamaccount ${SRCDS_TOKEN}"
fi

if [[ ! -z $CS2_HOST_WORKSHOP_COLLECTION ]] || [[ ! -z $CS2_HOST_WORKSHOP_MAP ]]; then
    CS2_MP_MATCH_END_CHANGELEVEL="+mp_match_end_changelevel true"   # https://github.com/joedwards32/CS2/issues/57#issuecomment-2245595368
    CS2_STARTMAP="\<empty\>"                                        # https://github.com/joedwards32/CS2/issues/57#issuecomment-2245595368
    CS2_MAPGROUP_ARGS=
else
    CS2_MAPGROUP_ARGS="+mapgroup ${CS2_MAPGROUP}"
fi

if [[ ! -z $CS2_HOST_WORKSHOP_COLLECTION ]]; then
    CS2_HOST_WORKSHOP_COLLECTION_ARGS="+host_workshop_collection ${CS2_HOST_WORKSHOP_COLLECTION}"
fi

if [[ ! -z $CS2_HOST_WORKSHOP_MAP ]]; then
    CS2_HOST_WORKSHOP_MAP_ARGS="+host_workshop_map ${CS2_HOST_WORKSHOP_MAP}"
fi

if [[ ! -z $CS2_PW ]]; then
    CS2_PW_ARGS="+sv_password ${CS2_PW}"
fi

# Start Server
LOG="${STEAMAPPDIR}/game/csgo/server_console.log"
BOOT_TIMEOUT="${CS2_BOOT_TIMEOUT:-240}"
BOOT_MAX="${CS2_BOOT_MAX_ATTEMPTS:-10}"
STOPPING=0
boot_attempt=0

trap 'echo "SIGTERM recebido; repassando ao jogo..."; STOPPING=1; kill -TERM "${GAME_PID}" 2>/dev/null' TERM INT

echo "Starting CS2 Dedicated Server"
# Watchdog de boot: o build atual do CS2 as vezes trava no spawn do mapa
# (fica em "ss_waitingforgamesessionmanifest", esperando o gamesession
# manifest da GC que nunca chega) sem fechar o processo. Se em BOOT_TIMEOUT
# segundos o servidor nao disser "player server started", matamos o jogo e
# tentamos de novo, ate BOOT_MAX tentativas. Isso deixa o servidor
# auto-recuperavel 24/7 (nao exec: o jogo vira processo filho e o docker stop
# e repassado via trap).
while :; do
    boot_attempt=$((boot_attempt+1))
    echo "--- Boot attempt ${boot_attempt}/${BOOT_MAX} (timeout ${BOOT_TIMEOUT}s) ---"

    if [[ ! -z $CS2_RCON_PORT ]] && [[ $boot_attempt -eq 1 ]]; then
        echo "Establishing Simpleproxy for ${CS2_RCON_PORT} to 127.0.0.1:${CS2_PORT}"
        simpleproxy -L "${CS2_RCON_PORT}" -R 127.0.0.1:"${CS2_PORT}" &
    fi

    # stdbuf -o0/-e0: com stdout redirecionado p/ arquivo, forca flush imediato
    # de cada escrita p/ o watchdog enxergar o log em tempo real.
    stdbuf -o0 -e0 ./cs2 -dedicated \
            "${CS2_IP_ARGS}" -port "${CS2_PORT}" \
            -console \
            -usercon \
            -maxplayers "${CS2_MAXPLAYERS}" \
            "${CS2_GAME_MODE_ARGS}" \
            "${CS2_MAPGROUP_ARGS}" \
            +map "${CS2_STARTMAP}" \
            "${CS2_HOST_WORKSHOP_COLLECTION_ARGS}" \
            "${CS2_HOST_WORKSHOP_MAP_ARGS}" \
            "${CS2_MP_MATCH_END_CHANGELEVEL}" \
            +rcon_password "${CS2_RCONPW}" \
            "${SV_SETSTEAMACCOUNT_ARGS}" \
            "${CS2_PW_ARGS}" \
            +sv_lan "${CS2_LAN}" \
            +tv_port "${TV_PORT}" \
            "${CS2_ADDITIONAL_ARGS}" \
            > "$LOG" 2>&1 &
    GAME_PID=$!

    # espelha o log do jogo no stdout do container (docker logs), ate o jogo morrer
    stdbuf -o0 tail -n 0 -f "$LOG" --pid "$GAME_PID" &

    up=0
    wait_sec=0
    while kill -0 "$GAME_PID" 2>/dev/null; do
        if grep -q 'player server started' "$LOG" 2>/dev/null; then
            up=1
            break
        fi
        if [[ "$wait_sec" -ge "$BOOT_TIMEOUT" ]]; then
            break
        fi
        sleep 10
        wait_sec=$((wait_sec+10))
    done

    if [[ "$STOPPING" -eq 1 ]]; then
        echo "Stop solicitado durante o boot; encerrando."
        exit 0
    fi

    if [[ "$up" -eq 1 ]]; then
        echo "Servidor no ar (PID ${GAME_PID}). Aguardando o processo..."
        wait "$GAME_PID"
        rc=$?
        echo "Processo do jogo encerrou (rc=${rc})."
        exit "$rc"
    fi

    if kill -0 "$GAME_PID" 2>/dev/null; then
        echo "Nao chegou a 'player server started' em ${BOOT_TIMEOUT}s — travado no cold start, matando."
    else
        echo "Jogo saiu sozinho antes de subir (crash)."
    fi
    kill -TERM "$GAME_PID" 2>/dev/null
    sleep 5
    kill -KILL "$GAME_PID" 2>/dev/null
    wait "$GAME_PID" 2>/dev/null

    if [[ "$boot_attempt" -ge "$BOOT_MAX" ]]; then
        echo "Esgotadas ${BOOT_MAX} tentativas de boot."
        exit 1
    fi
    echo "Tentando de novo em 15s..."
    sleep 15
done
