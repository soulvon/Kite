import argparse
import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

DEVIN_USER = Path(r"C:\Users\admin\AppData\Roaming\Devin\User")
DEVIN_EXTENSIONS = Path(r"C:\Users\admin\.devin\extensions")
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

# local.windsurf-pool is the stable extension id again. Only the short-lived
# local.kite rename is treated as stale residue.
STALE_EXTENSION_IDS = {"local.kite"}
STALE_SUBSTRINGS = [
    "local.kite",
]

SAFE_DELETE_KEY_PREFIXES = (
    "workbench.view.extension.local.kite",
    "workbench.panel.extension.local.kite",
)

JSON_FILTER_KEYS = {
    "workbench.explorer.views.state.hidden",
    "workbench.explorer.views.state",
    "workbench.explorer.treeViewState",
    "workbench.activity.pinnedViewlets2",
    "workbench.activity.placeholderViewlets",
    "workbench.activity.viewletsWorkspaceState",
    "workbench.view.extension.windsurfPool.state.hidden",
    "notifications.perSourceDoNotDisturbMode",
    "extensionsIdentifiers/disabled",
    "memento/webviewViews.origins",
    "memento/mainThreadWebviewPanel.origins",
}


def backup(path: Path, backup_root: Path) -> Path:
    rel = path.drive.replace(":", "") + path.as_posix().replace(":", "")
    rel = rel.replace("/", "_").replace("\\", "_").strip("_")
    dst = backup_root / f"{rel}.bak"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dst)
    return dst


def load_json(text, fallback):
    try:
        return json.loads(text)
    except Exception:
        return fallback


def text_has_stale(value) -> bool:
    if value is None:
        return False
    if isinstance(value, bytes):
        text = value.decode("utf-8", errors="ignore")
    else:
        text = str(value)
    return any(marker in text for marker in STALE_SUBSTRINGS)


def compact_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def remove_stale_from_json(value):
    changed = False
    if isinstance(value, list):
        new_list = []
        for item in value:
            item_text = compact_json(item)
            if text_has_stale(item_text):
                changed = True
                continue
            new_item, item_changed = remove_stale_from_json(item)
            changed = changed or item_changed
            new_list.append(new_item)
        return new_list, changed
    if isinstance(value, dict):
        new_dict = {}
        for key, item in value.items():
            key_text = str(key)
            parsed_key = load_json(key_text, None)
            parsed_key_stale = False
            if isinstance(parsed_key, dict):
                parsed_key_stale = (
                    str(parsed_key.get("key", "")) in STALE_EXTENSION_IDS
                    or str(parsed_key.get("extensionId", "")) in STALE_EXTENSION_IDS
                )
            if text_has_stale(key_text) or parsed_key_stale:
                changed = True
                continue
            item_text = compact_json(item) if isinstance(item, (dict, list)) else str(item)
            if text_has_stale(item_text):
                changed = True
                continue
            new_item, item_changed = remove_stale_from_json(item)
            changed = changed or item_changed
            new_dict[key] = new_item
        return new_dict, changed
    return value, False


def clean_settings(backup_root: Path, apply: bool):
    return []


def clean_extensions_json(backup_root: Path, apply: bool):
    path = DEVIN_EXTENSIONS / "extensions.json"
    if not path.exists():
        return []
    data = load_json(path.read_text("utf-8"), [])
    new_data = []
    removed = []
    for item in data:
        ext_id = str(item.get("identifier", {}).get("id", ""))
        if ext_id in STALE_EXTENSION_IDS:
            removed.append(ext_id)
        else:
            new_data.append(item)
    if removed and apply:
        backup(path, backup_root)
        path.write_text(compact_json(new_data), "utf-8")
    return [f"extensions.json remove {ext_id}" for ext_id in removed]


def clean_sqlite(db_path: Path, backup_root: Path, apply: bool):
    if not db_path.exists():
        return []
    changes = []
    con = sqlite3.connect(str(db_path))
    try:
        rows = dict(con.execute("select key, value from ItemTable").fetchall())
        updates = []
        deletes = []
        for key, value in rows.items():
            key_text = str(key)
            value_text = value.decode("utf-8", errors="ignore") if isinstance(value, bytes) else str(value)
            if key_text.startswith("secret://"):
                continue
            if key_text in STALE_EXTENSION_IDS or key_text.startswith(SAFE_DELETE_KEY_PREFIXES):
                deletes.append(key_text)
                continue
            if key_text in JSON_FILTER_KEYS:
                parsed = load_json(value_text, None)
                if parsed is not None:
                    cleaned, changed = remove_stale_from_json(parsed)
                    if changed:
                        updates.append((key_text, compact_json(cleaned)))
                        continue
            if text_has_stale(key_text) and not key_text.startswith("history."):
                deletes.append(key_text)

        if apply and (updates or deletes):
            backup(db_path, backup_root)
            cur = con.cursor()
            for key, value in updates:
                cur.execute("update ItemTable set value=? where key=?", (value, key))
            for key in deletes:
                cur.execute("delete from ItemTable where key=?", (key,))
            con.commit()

        for key, _ in updates:
            changes.append(f"{db_path}: update {key}")
        for key in deletes:
            changes.append(f"{db_path}: delete {key}")
    finally:
        con.close()
    return changes


def move_stale_dirs(backup_root: Path, apply: bool):
    moves = []
    candidates = [
        DEVIN_USER / "globalStorage" / "local.kite",
    ]
    for path in candidates:
        if path.exists():
            dst = backup_root / "moved-dirs" / path.name
            moves.append(f"move {path} -> {dst}")
            if apply:
                dst.parent.mkdir(parents=True, exist_ok=True)
                if dst.exists():
                    shutil.rmtree(dst)
                shutil.move(str(path), str(dst))
    if DEVIN_EXTENSIONS.exists():
        for path in DEVIN_EXTENSIONS.iterdir():
            if path.is_dir() and path.name.startswith("local.kite"):
                dst = backup_root / "moved-dirs" / path.name
                moves.append(f"move {path} -> {dst}")
                if apply:
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    if dst.exists():
                        shutil.rmtree(dst)
                    shutil.move(str(path), str(dst))
    return moves


def iter_state_dbs():
    yield DEVIN_USER / "globalStorage" / "state.vscdb"
    workspace_root = DEVIN_USER / "workspaceStorage"
    if workspace_root.exists():
        for path in workspace_root.glob("*/state.vscdb"):
            yield path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply cleanup. Without this flag, only reports planned changes.")
    args = parser.parse_args()

    backup_root = DEVIN_USER / "kite-residue-backups" / STAMP
    changes = []
    changes += clean_settings(backup_root, args.apply)
    changes += clean_extensions_json(backup_root, args.apply)
    for db_path in iter_state_dbs():
        changes += clean_sqlite(db_path, backup_root, args.apply)
    changes += move_stale_dirs(backup_root, args.apply)

    print(f"mode={'apply' if args.apply else 'dry-run'}")
    print(f"backup_root={backup_root if args.apply else '(not created in dry-run)'}")
    if changes:
        for change in changes:
            print(change)
    else:
        print("no stale Kite/windsurfPool residue found")


if __name__ == "__main__":
    main()
