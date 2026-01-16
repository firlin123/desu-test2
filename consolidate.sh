#!/usr/bin/env bash

# =============================================================
# CONFIGURATION
# =============================================================

# Internet Archive item ID for uploads
#IA_ITEM_ID="mlp-post-archive"
IA_ITEM_ID="test1_202512"
MANIFEST="manifest.json"

# 2012-02-17 00:39:50 ET is the date of the first /mlp/ post
BASE_YEAR="2012"
BASE_MONTH="02"
BASE_DAY="17"
BASE_HOUR="00"
BASE_MINUTE="39"
BASE_SECOND="50"

# Thresholds for forced consolidation
MONTHLY_THRESHOLD=32
YEARLY_THRESHOLD=13

export TZ='America/New_York'

# =============================================================
# ENVIRONMENT CHECKS
# =============================================================

for cmd in jq gh xz node; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Required command '$cmd' not found. Please install it and retry."
    fi
done

if ! command -v ia >/dev/null 2>&1; then
    echo "'ia' CLI not found. Install with 'pip install internetarchive' and configure with 'ia configure'."
    exit 1
fi

if [[ ! -f "$MANIFEST" ]]; then
    echo "'$MANIFEST' not found."
    exit 1
fi

# =============================================================
# FUNCTIONS
# =============================================================

function commit_and_tag() {
    local tag_name="$1"
    if ! git log --format=%s | grep -qx "$tag_name"; then
        git add "$MANIFEST" || return 1
        git commit -m "$tag_name" || return 1
        git push || return 1
    fi
    if ! git rev-parse "$tag_name" >/dev/null 2>&1; then
        git tag "$tag_name" || return 1
        git push origin "$tag_name" || return 1
    fi
}

function get_day_label() {
    local raw="$1"
    local date_str="${raw:0:4}-${raw:4:2}-${raw:6:2}"
    local time_str="${raw:8:2}:${raw:10:2}:${raw:12:2}"

    local prev_ts="$(date -d "$date_str $BASE_HOUR:$BASE_MINUTE:$BASE_SECOND" +%s)"
    local curr_ts="$(date -d "$date_str $time_str" +%s)"
    local next_ts="$(date -d "$date_str +1 day $BASE_HOUR:$BASE_MINUTE:$BASE_SECOND" +%s)"
    if (( curr_ts < prev_ts )); then
        # Before base time, shift the comparison window back one day
        prev_ts="$(date -d "$date_str -1 day $BASE_HOUR:$BASE_MINUTE:$BASE_SECOND" +%s)"
        next_ts="$(date -d "$date_str $BASE_HOUR:$BASE_MINUTE:$BASE_SECOND" +%s)"
    fi

    local diff_prev=$((curr_ts - prev_ts))
    local diff_next=$((next_ts - curr_ts))

    if (( diff_prev <= diff_next )); then
        date -d "@$prev_ts" "+%Y-%m-%d"
    else
        date -d "@$next_ts" "+%Y-%m-%d"
    fi
}

function get_month_label() {
    local raw="$1"
    local ym_str="${raw:0:4}-${raw:4:2}"
    local dhms_str="${raw:6:8} ${raw:8:2}:${raw:10:2}:${raw:12:2}"
    
    local prev_ts="$(date -d "$ym_str-$BASE_DAY $BASE_HOUR:$BASE_MINUTE:$BASE_SECOND" +%s)"
    local curr_ts="$(date -d "$ym_str-$dhms_str" +%s)"
    local next_ts="$(date -d "$ym_str-$BASE_DAY +1 month $BASE_HOUR:$BASE_MINUTE:$BASE_SECOND" +%s)"
    if (( curr_ts < prev_ts )); then
        # Before base time, shift the comparison window back one month
        prev_ts="$(date -d "$ym_str-$BASE_DAY -1 month $BASE_HOUR:$BASE_MINUTE:$BASE_SECOND" +%s)"
        next_ts="$(date -d "$ym_str-$BASE_DAY $BASE_HOUR:$BASE_MINUTE:$BASE_SECOND" +%s)"
    fi

    local diff_prev=$((curr_ts - prev_ts))
    local diff_next=$((next_ts - curr_ts))

    if (( diff_prev <= diff_next )); then
        date -d "@$prev_ts" "+%Y-%m"
    else
        date -d "@$next_ts" "+%Y-%m"
    fi
}

function get_year_label() {
    local raw="$1"
    local y_str="${raw:0:4}"
    local mdhms_str="${raw:4:2}-${raw:6:2} ${raw:8:2}:${raw:10:2}:${raw:12:2}"

    local prev_ts="$(date -d "$y_str-$BASE_MONTH-$BASE_DAY $BASE_HOUR:$BASE_MINUTE:$BASE_SECOND" +%s)"
    local curr_ts="$(date -d "$y_str-$mdhms_str" +%s)"
    local next_ts="$(date -d "$y_str-$BASE_MONTH-$BASE_DAY +1 year $BASE_HOUR:$BASE_MINUTE:$BASE_SECOND" +%s)"

    if (( curr_ts < prev_ts )); then
        # Before base time, shift the comparison window back one year
        prev_ts="$(date -d "$y_str-$BASE_MONTH-$BASE_DAY -1 year $BASE_HOUR:$BASE_MINUTE:$BASE_SECOND" +%s)"
        next_ts="$(date -d "$y_str-$BASE_MONTH-$BASE_DAY $BASE_HOUR:$BASE_MINUTE:$BASE_SECOND" +%s)"
    fi

    local diff_prev=$((curr_ts - prev_ts))
    local diff_next=$((next_ts - curr_ts))

    if (( diff_prev <= diff_next )); then
        date -d "@$prev_ts" "+%Y"
    else
        date -d "@$next_ts" "+%Y"
    fi
}

function upload_daily() {
    local daily_count="$(jq '.daily | length' "$MANIFEST" 2>/dev/null || echo 0)"
    if (( daily_count <= 0 )); then
        return 0
    fi
    local daily="$(jq -r '.daily[-1]' "$MANIFEST" 2>/dev/null || echo 0)"
    if gh release view "$daily" >/dev/null 2>&1; then
        echo "Daily release '$daily' already exists. Skipping upload."
        return 0
    fi
    if [[ "$daily" =~ ^([0-9]{14})_daily_([0-9]+)_([0-9]+)$ ]]; then
        local end_ts="${BASH_REMATCH[1]}"
        local start_post="${BASH_REMATCH[2]}"
        local end_post="${BASH_REMATCH[3]}"
    else
        echo "Invalid daily release name format: $daily"
        return 1
    fi
    echo "Preparing daily archive upload for release '$daily'..."
    local daily_file="$daily.json"
    if [[ ! -f "$daily_file" ]]; then
        echo "Daily file '$daily_file' not found."
        return 1
    fi
    echo "Compressing daily file '$daily_file'..."
    local daily_xz="$daily_file.xz"
    if ! xz -9e -c "$daily_file" > "$daily_xz"; then
        echo "Failed to compress daily file '$daily_file'."
        return 1
    fi
    if ! commit_and_tag "$daily"; then
        echo "Failed to commit and tag daily release."
        return 1
    fi
    echo "Uploading daily archive to GitHub Releases..."
    local date_label="$(get_day_label "$end_ts")"
    if ! gh release create "$daily" "$daily_xz" \
        --title "$date_label daily archive ($start_post - $end_post)" \
        --notes "Automated daily scrape of /mlp/ posts for $date_label, covering posts $start_post to $end_post."; then
        echo "Failed to create GitHub release for daily archive."
        return 1
    fi

    echo "Daily archive '$daily' uploaded successfully."
}

function consolidate_monthly() {
    local daily_count="$(jq '.daily | length' "$MANIFEST" 2>/dev/null || echo 0)"
    if (( daily_count <= 0 )); then
        return 0
    fi
    local last_daily="$(jq -r '.daily[-1]' "$MANIFEST" 2>/dev/null || echo 0)"
    if [[ "$last_daily" =~ ^([0-9]{14})_daily_[0-9]+_([0-9]+)$ ]]; then
        local end_ts="${BASH_REMATCH[1]}"
        local end_post="${BASH_REMATCH[2]}"
    else
        echo "Invalid daily release name format: $last_daily"
        return 1
    fi
    # Increment end_ts by one second
    end_ts="$(date -d "${end_ts:0:4}-${end_ts:4:2}-${end_ts:6:2} ${end_ts:8:2}:${end_ts:10:2}:${end_ts:12:2} +1 second" "+%Y%m%d%H%M%S")"
    # yyyy-mm-dd
    local end_label="$(get_day_label "$end_ts")"
    local end_day="${end_label:8:2}"
    local next_label="${date -d "$end_label +1 day" "+%Y-%m-%d"}"
    local next_day="${next_label:8:2}"

    if (( daily_count < MONTHLY_THRESHOLD && next_day != BASE_DAY )); then
        return 0
    fi

    local first_daily="$(jq -r '.daily[0]' "$MANIFEST" 2>/dev/null || echo 0)"
    if [[ "$first_daily" =~ ^[0-9]{14}_daily_([0-9]+)_[0-9]+$ ]]; then
        local start_post="${BASH_REMATCH[1]}"
    else
        echo "Invalid daily release name format: $first_daily"
        return 1
    fi

    echo "Consolidating $daily_count daily archives into a monthly archive..."
    
    readarray -t daily_list < <(jq -r '.daily[]' "$MANIFEST")
    local monthly="${end_ts}_monthly_${start_post}_${end_post}"
    local monthly_file="$monthly.json"
    >"$monthly_file"

    for daily in "${daily_list[@]}"; do
        local daily_file="$daily.json"
        if [[ ! -f "$daily_file" ]]; then
            local daily_xz="$daily_file.xz"
            if [[ ! -f "$daily_xz" ]]; then
                echo "Downloading daily archive '$daily' from GitHub Releases..."
                if ! gh release download "$daily" -p "$daily_xz"; then
                    echo "Failed to download daily archive '$daily'."
                    return 1
                fi
            fi
            echo "Decompressing daily archive '$daily_xz'..."
            if ! xz -d -c "$daily_xz" > "$daily_file"; then
                echo "Failed to decompress daily archive '$daily_xz'."
                return 1
            fi
        fi
        cat "$daily_file" >> "$monthly_file"
    done

    echo "Running reCheck on monthly archive..."
    if ! node src/reCheck.js "$monthly_file"; then
        echo "Monthly archive '$monthly_file' reCheck failed."
        return 1
    fi

    echo "Compressing monthly archive..."
    local monthly_xz="$monthly_file.xz"
    if ! xz -9e -c "$monthly_file" > "$monthly_xz"; then
        echo "Failed to compress monthly archive '$monthly_file'."
        return 1
    fi

    # Replace daily -> monthly in manifest
    if ! jq --arg name "$monthly" '.daily = [] | .monthly += [$name]' "$MANIFEST" > "$MANIFEST.tmp"; then
        rm -rf "$MANIFEST.tmp" || true
        echo "Failed to update manifest for monthly archive."
        return 1
    fi
    mv "$MANIFEST.tmp" "$MANIFEST"

    if ! gh release view "$MONTHLY" >/dev/null 2>&1; then
        if ! commit_and_tag "$monthly"; then
            echo "Failed to commit and tag monthly release."
            return 1
        fi
        echo "Uploading monthly archive to GitHub Releases..."
        local month_label="$(get_month_label "$end_ts")"
        if ! gh release create "$monthly" "$monthly_xz" \
            --title "$month_label monthly archive ($start_post - $end_post)" \
            --notes "Automated consolidation of /mlp/ posts for $month_label, covering posts $start_post to $end_post."; then
            echo "Failed to create GitHub release for monthly archive."
            return 1
        fi
    fi

    echo "Removing old daily releases..."
    for daily in "${daily_list[@]}"; do
        echo "Deleting daily release '$daily'..."
        if ! gh release delete "$daily" -y 2>/dev/null; then
            echo "WARN: Failed to delete daily release '$daily'. Continuing..."
        fi
        if ! git push --delete origin "$daily" 2>/dev/null; then
            echo "WARN: Failed to delete daily tag '$daily' from remote. Continuing..."
        fi
        if ! git tag -d "$D" 2>/dev/null; then
            echo "WARN: Failed to delete daily tag '$daily' locally. Continuing..."
        fi
    done

    echo "Monthly consolidation complete."
}

function consolidate_yearly() {
    local monthly_count="$(jq '.monthly | length' "$MANIFEST" 2>/dev/null || echo 0)"
    if (( monthly_count <= 0 )); then
        return 0
    fi
    local last_monthly="$(jq -r '.monthly[-1]' "$MANIFEST" 2>/dev/null || echo 0)"
    if [[ "$last_monthly" =~ ^([0-9]{14})_monthly_[0-9]+_([0-9]+)$ ]]; then
        local end_ts="${BASH_REMATCH[1]}"
        local end_post="${BASH_REMATCH[2]}"
    else
        echo "Invalid monthly release name format: $last_monthly"
        return 1
    fi
    # Increment end_ts by one second
    end_ts="$(date -d "${end_ts:0:4}-${end_ts:4:2}-${end_ts:6:2} ${end_ts:8:2}:${end_ts:10:2}:${end_ts:12:2} +1 second" "+%Y%m%d%H%M%S")"
    # yyyy-mm
    local end_label="$(get_month_label "$end_ts")"
    local end_month="${end_label:5:2}"
    local next_label="${date -d "$end_label +1 month" "+%Y-%m"}"
    local next_month="${next_label:5:2}"

    if (( monthly_count < YEARLY_THRESHOLD && next_month != BASE_MONTH )); then
        return 0
    fi

    # Allow archives 2 days to settle before the reCheck
    local grace_end_ts="${date -d "${end_ts:0:4}-${end_ts:4:2}-${end_ts:6:2} +2 days" "+%s"}"
    local curr_ts="$(date "+%s")"

    if (( curr_ts < grace_end_ts )); then
        return 0
    fi

    local first_monthly="$(jq -r '.monthly[0]' "$MANIFEST" 2>/dev/null || echo 0)"
    if [[ "$first_monthly" =~ ^[0-9]{14}_monthly_([0-9]+)_[0-9]+$ ]]; then
        local start_post="${BASH_REMATCH[1]}"
    else
        echo "Invalid monthly release name format: $first_monthly"
        return 1
    fi

    if ! ia configure --whoami >/dev/null 2>&1; then
        if [[ -z "${IA_EMAIL:-}" || -z "${IA_PASSWORD:-}" ]]; then
            echo "Internet Archive CLI not configured. Please provide IA_EMAIL and IA_PASSWORD environment variables or run 'ia configure' manually."
            return 1
        fi

        echo "Configuring Internet Archive CLI..."
        if ! ia configure --username "$IA_EMAIL" --password "$IA_PASSWORD"; then
            echo "Failed to configure Internet Archive CLI. Please check your credentials or run 'ia configure' manually."
            return 1
        fi

        echo "Verifying Internet Archive CLI configuration..."
        if ! ia configure --whoami >/dev/null 2>&1; then
            echo "Internet Archive CLI configuration verification failed. Please check your credentials or run 'ia configure' manually."
            return 1
        fi

        echo "Internet Archive CLI configured successfully."
    fi

    echo "Consolidating $monthly_count monthly archives into a yearly archive..."
    readarray -t monthly_list < <(jq -r '.monthly[]' "$MANIFEST")
    local yearly="${end_ts}_yearly_${start_post}_${end_post}"
    local yearly_file="$yearly.json"
    >"$yearly_file"

    for monthly in "${monthly_list[@]}"; do
        local monthly_file="$monthly.json"
        if [[ ! -f "$monthly_file" ]]; then
            local monthly_xz="$monthly_file.xz"
            if [[ ! -f "$monthly_xz" ]]; then
                echo "Downloading monthly archive '$monthly' from GitHub Releases..."
                if ! gh release download "$monthly" -p "$monthly_xz"; then
                    echo "Failed to download monthly archive '$monthly'."
                    return 1
                fi
            fi
            echo "Decompressing monthly archive '$monthly_xz'..."
            if ! xz -d -c "$monthly_xz" > "$monthly_file"; then
                echo "Failed to decompress monthly archive '$monthly_xz'."
                return 1
            fi
        fi
        cat "$monthly_file" >> "$yearly_file"
    done

    echo "Running reCheck on yearly archive..."
    if ! node src/reCheck.js "$yearly_file"; then
        echo "Yearly archive '$yearly_file' reCheck failed."
        return 1
    fi

    echo "Compressing yearly archive..."
    local yearly_xz="$yearly_file.xz"
    if ! xz -9e -c "$yearly_file" > "$yearly_xz"; then
        echo "Failed to compress yearly archive '$yearly_file'."
        return 1
    fi

    local ia_url = "https://archive.org/download/$IA_ITEM_ID/$yearly_xz"

    # Replace monthly -> yearly in manifest
    if ! jq --arg name "$yearly" --arg url "$ia_url" '.monthly = [] | .yearly += [{"name":$name,"url":$url}]' "$MANIFEST" > "$MANIFEST.tmp"; then
        rm -rf "$MANIFEST.tmp" || true
        echo "Failed to update manifest for yearly archive."
        return 1
    fi
    mv "$MANIFEST.tmp" "$MANIFEST"

    # Check if it alredy exists in IA item
    if ! ia list "$IA_ITEM_ID" | grep -qx "$yearly_xz"; then
        echo "Uploading yearly archive to Internet Archive..."
        if ! ia upload "$IA_ITEM_ID" "$yearly_xz"; then
            echo "Failed to upload yearly archive to Internet Archive."
            return 1
        fi
    fi
    
    if ! commit_and_tag "$yearly"; then
        echo "Failed to commit and tag yearly release."
        return 1
    fi

    echo "Removing old monthly releases..."
    for monthly in "${monthly_list[@]}"; do
        echo "Deleting monthly release '$monthly'..."
        if ! gh release delete "$monthly" -y 2>/dev/null; then
            echo "WARN: Failed to delete monthly release '$monthly'. Continuing..."
        fi
        if ! git push --delete origin "$monthly" 2>/dev/null; then
            echo "WARN: Failed to delete monthly tag '$monthly' from remote. Continuing..."
        fi
        if ! git tag -d "$monthly" 2>/dev/null; then
            echo "WARN: Failed to delete monthly tag '$monthly' locally. Continuing..."
        fi
    done

    echo "Yearly consolidation complete."
}

# =============================================================
# MAIN SCRIPT EXECUTION
# =============================================================

if ! upload_daily; then
    exit 1
fi

if ! consolidate_monthly; then
    exit 1
fi

if ! consolidate_yearly; then
    exit 1
fi

echo "Archive consolidation process completed successfully."