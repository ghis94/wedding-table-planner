import json
import math
import os
import sqlite3
from html import escape
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

APP_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("DB_PATH", APP_DIR / "data" / "wedding.db"))
TABLE_SIZE = 180
TABLE_RADIUS = TABLE_SIZE / 2
INNER_RING_RADIUS = 118
OUTER_RING_RADIUS = 174
CARD_PADDING = 34
GRID_GAP_X = 52
GRID_GAP_Y = 58


@st.cache_data(ttl=2)
def load_plan(db_path: str):
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute("SELECT data FROM plan WHERE id=1").fetchone()
        if not row or not row[0]:
            return {"tables": [], "guests": [], "layout": {"tables": {}, "guests": {}}}
        payload = json.loads(row[0])
        payload.setdefault("tables", [])
        payload.setdefault("guests", [])
        payload.setdefault("layout", {"tables": {}, "guests": {}})
        return payload
    finally:
        conn.close()


@st.cache_data(ttl=5)
def load_rsvps(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT id, nom, prenom, presence, adultes, enfants, regime, phone, adminNotes, createdAt FROM rsvps ORDER BY datetime(createdAt) DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def estimate_chip_size(guest):
    name = str((guest or {}).get("name") or "Place")
    regime = str((guest or {}).get("regime") or "").strip()
    width = min(130, max(86, round(len(name) * 6.2) + (22 if regime else 12)))
    height = 42 if regime else 30
    return width, height


def ring_distribution(capacity: int):
    total = max(1, int(capacity or 1))
    if total <= 8:
        return [total]
    if total <= 12:
        return [total]
    rings = []
    left = total
    for take_max in (10, 14, 18):
        if left <= 0:
            break
        take = min(left, take_max)
        rings.append(take)
        left -= take
    while left > 0:
        take = min(left, 20)
        rings.append(take)
        left -= take
    return rings


def seat_layout(seat_index: int, capacity: int, guest):
    rings = ring_distribution(capacity)
    idx = seat_index
    ring_idx = 0
    while ring_idx < len(rings) and idx >= rings[ring_idx]:
        idx -= rings[ring_idx]
        ring_idx += 1
    count = max(1, rings[ring_idx] if ring_idx < len(rings) else 1)
    radius = INNER_RING_RADIUS + ring_idx * (OUTER_RING_RADIUS - INNER_RING_RADIUS)
    step = (math.pi * 2) / count
    angle = (-math.pi / 2) + idx * step + ((step / 2) if ring_idx % 2 else 0)
    width, height = estimate_chip_size(guest)
    cx = CARD_PADDING + TABLE_RADIUS
    cy = CARD_PADDING + TABLE_RADIUS
    return {
        "x": round(cx + math.cos(angle) * radius - width / 2),
        "y": round(cy + math.sin(angle) * radius - height / 2),
        "width": width,
        "height": height,
    }


def cluster_bounds(capacity: int):
    min_x = CARD_PADDING
    min_y = CARD_PADDING
    max_x = CARD_PADDING + TABLE_SIZE
    max_y = CARD_PADDING + TABLE_SIZE
    for idx in range(max(1, capacity)):
        seat = seat_layout(idx, capacity, {"name": "Placeholder invité", "regime": "sans gluten"})
        min_x = min(min_x, seat["x"])
        min_y = min(min_y, seat["y"])
        max_x = max(max_x, seat["x"] + seat["width"])
        max_y = max(max_y, seat["y"] + seat["height"])
    pad = 26
    return {
        "width": max(TABLE_SIZE, max_x - min_x + pad * 2),
        "height": max(TABLE_SIZE, max_y - min_y + pad * 2),
        "offset_x": pad - min_x,
        "offset_y": pad - min_y,
    }


def layout_tables(tables, max_cols=3):
    entries = []
    max_w = TABLE_SIZE
    max_h = TABLE_SIZE
    for table in tables:
        capacity = max(1, int(table.get("capacity") or 1))
        bounds = cluster_bounds(capacity)
        entries.append({"table": table, "capacity": capacity, "bounds": bounds})
        max_w = max(max_w, bounds["width"])
        max_h = max(max_h, bounds["height"])

    cols = max(1, min(max_cols, len(entries) if entries else 1))
    for idx, entry in enumerate(entries):
        col = idx % cols
        row = idx // cols
        entry["x"] = 24 + col * (max_w + GRID_GAP_X) + round((max_w - entry["bounds"]["width"]) / 2)
        entry["y"] = 24 + row * (max_h + GRID_GAP_Y) + round((max_h - entry["bounds"]["height"]) / 2)
    width = 48 + cols * max_w + max(0, cols - 1) * GRID_GAP_X
    rows = math.ceil(len(entries) / cols) if entries else 1
    height = 48 + rows * max_h + max(0, rows - 1) * GRID_GAP_Y
    return entries, width, height


def regime_dot(regime: str):
    r = (regime or "").lower()
    if "vegan" in r:
        return "#15803d"
    if "végé" in r or "vege" in r or "végétar" in r:
        return "#16a34a"
    if "sans porc" in r:
        return "#ea580c"
    if "halal" in r:
        return "#0f766e"
    if "kasher" in r or "casher" in r:
        return "#2563eb"
    if "gluten" in r:
        return "#dc2626"
    if "lactose" in r:
        return "#c2410c"
    return "#64748b"


def chip_html(guest, x, y, width, height, empty=False):
    if empty:
        return f"""
        <div class='seat empty' style='left:{x}px;top:{y}px;width:{width}px;height:{height}px;'>
          <span>Place vide</span>
        </div>
        """
    name = escape(str(guest.get("name") or "Invité"))
    regime = escape(str(guest.get("regime") or "").strip())
    guest_type = escape(str(guest.get("type") or "adulte"))
    type_label = "" if guest_type == "adulte" else ("Enfant" if guest_type == "enfant" else "Bébé")
    type_class = "enfant" if guest_type == "enfant" else ("bebe" if guest_type == "bebe" else "")
    regime_html = f"<span class='pill regime'><i style='background:{regime_dot(regime)}'></i>{regime}</span>" if regime else ""
    type_html = f"<span class='pill type {type_class}'>{type_label}</span>" if type_label else ""
    return f"""
    <div class='seat chip' style='left:{x}px;top:{y}px;width:{width}px;height:{height}px;'>
      <span class='name'>{name}</span>
      <div class='meta'>{type_html}{regime_html}</div>
    </div>
    """


def render_plan(plan, max_cols=3):
    tables = plan.get("tables") or []
    entries, width, height = layout_tables(tables, max_cols=max_cols)
    parts = []
    for entry in entries:
        table = entry["table"]
        bounds = entry["bounds"]
        guests = table.get("guests") or []
        tx = entry["x"]
        ty = entry["y"]
        table_left = tx + CARD_PADDING + bounds["offset_x"]
        table_top = ty + CARD_PADDING + bounds["offset_y"]
        ratio = min(100, round((len(guests) / max(1, entry['capacity'])) * 100))
        cluster = [f"<section class='cluster' style='left:{tx}px;top:{ty}px;width:{bounds['width']}px;height:{bounds['height']}px;'>"]
        cluster.append(
            f"""
            <div class='table'>
              <div class='table-shell' style='left:{table_left}px;top:{table_top}px;'>
                <div class='inner'>
                  <div class='table-name'>{escape(str(table.get('name') or 'Table'))}</div>
                  <div class='table-meta'>{len(guests)}/{entry['capacity']} places</div>
                  <div class='progress'><span style='width:{ratio}%;'></span></div>
                </div>
              </div>
            </div>
            """
        )
        for idx in range(entry["capacity"]):
            guest = guests[idx] if idx < len(guests) else None
            seat = seat_layout(idx, entry["capacity"], guest or {"name": "Place vide", "regime": ""})
            cluster.append(chip_html(guest or {}, tx + seat["x"] + bounds["offset_x"], ty + seat["y"] + bounds["offset_y"], seat["width"], seat["height"], empty=guest is None))
        cluster.append("</section>")
        parts.append("".join(cluster))

    return f"""
    <style>
      .board {{
        position: relative;
        min-height: {height}px;
        width: {width}px;
        margin: 0 auto;
        background:
          radial-gradient(circle at top left, rgba(255,255,255,.75), transparent 24%),
          linear-gradient(180deg, rgba(255,252,247,.98), rgba(244,235,224,.96));
        border: 1px solid rgba(164,127,89,.14);
        border-radius: 28px;
        box-shadow: 0 18px 48px rgba(67,44,23,.10);
        overflow: auto;
      }}
      .cluster {{ position: absolute; }}
      .table-shell {{
        position: absolute;
        width: {TABLE_SIZE}px;
        height: {TABLE_SIZE}px;
        border-radius: 50%;
        border: 1px solid rgba(164,127,89,.34);
        background: radial-gradient(circle at 30% 30%, #fffdf9 0%, #f6ecdf 56%, #eadbc8 100%);
        box-shadow: 0 20px 34px rgba(82,58,34,.14), inset 0 1px 0 rgba(255,255,255,.75);
      }}
      .table-shell::before {{ content:''; position:absolute; inset:10px; border-radius:50%; border:1px solid rgba(164,127,89,.20); }}
      .table-shell .inner {{ position:absolute; inset:0; display:grid; place-content:center; gap:8px; text-align:center; padding:20px; }}
      .table-name {{ font: 600 28px/1 'Georgia', serif; color:#241913; }}
      .table-meta {{ font: 700 10px/1.1 sans-serif; letter-spacing:.14em; text-transform:uppercase; color:#7f6957; }}
      .progress {{ width:104px; height:7px; margin:0 auto; border-radius:999px; overflow:hidden; background:rgba(138,102,70,.12); }}
      .progress span {{ display:block; height:100%; background:linear-gradient(90deg, #a47f59, #d0b08e); }}
      .seat {{
        position: absolute;
        border-radius: 18px;
        display:flex;
        flex-direction:column;
        justify-content:center;
        align-items:center;
        text-align:center;
        padding:6px 8px;
      }}
      .seat.empty {{
        border:1px dashed rgba(164,127,89,.38);
        background:rgba(255,255,255,.22);
        color:#7f6957;
        font:700 9px/1.2 sans-serif;
        letter-spacing:.14em;
        text-transform:uppercase;
      }}
      .seat.chip {{
        border:1px solid rgba(164,127,89,.20);
        background:linear-gradient(180deg, rgba(255,255,255,.98), rgba(248,241,233,.96));
        box-shadow:0 10px 24px rgba(67,44,23,.08);
      }}
      .name {{ font:600 16px/1.1 'Georgia', serif; color:#241913; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%; }}
      .meta {{ display:flex; gap:4px; flex-wrap:wrap; justify-content:center; margin-top:5px; }}
      .pill {{ display:inline-flex; align-items:center; gap:5px; padding:3px 7px; border-radius:999px; font:700 9px/1 sans-serif; text-transform:uppercase; letter-spacing:.05em; background:rgba(255,250,245,.92); border:1px solid rgba(130,102,77,.12); color:#5e4938; }}
      .pill.regime i {{ width:7px; height:7px; border-radius:999px; display:inline-block; }}
      .pill.type.enfant {{ background:#e8f2fb; color:#32556f; }}
      .pill.type.bebe {{ background:#fdf0e1; color:#9b5c24; }}
    </style>
    <div class="board">{''.join(parts)}</div>
    """


def main():
    st.set_page_config(page_title="Wedding Table Planner V2", page_icon="💒", layout="wide")
    st.title("Wedding Table Planner V2 · Streamlit")
    st.caption("Version séparée de main, pensée pour un rendu robuste sans chevauchement des tables.")

    if not DB_PATH.exists():
      st.error(f"Base SQLite introuvable: {DB_PATH}")
      st.stop()

    plan = load_plan(str(DB_PATH))
    rsvps = load_rsvps(str(DB_PATH))
    tables = plan.get("tables") or []
    guests_count = sum(len(t.get("guests") or []) for t in tables)
    capacity_total = sum(int(t.get("capacity") or 0) for t in tables)

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Tables", len(tables))
    col2.metric("Invités placés", guests_count)
    col3.metric("Capacité", capacity_total)
    col4.metric("RSVP", len(rsvps))

    with st.sidebar:
        st.header("Affichage")
        max_cols = st.slider("Tables par rangée", 1, 4, 3)
        st.button("Rafraîchir", on_click=load_plan.clear)
        st.caption(f"DB: {DB_PATH}")

    tab1, tab2 = st.tabs(["Plan visuel", "Tables & invités"])

    with tab1:
        html = render_plan(plan, max_cols=max_cols)
        components.html(html, height=980, scrolling=True)

    with tab2:
        selected = st.selectbox("Table", options=[t.get("name") or "Table" for t in tables] or ["Aucune"], index=0)
        table = next((t for t in tables if (t.get("name") or "Table") == selected), None)
        if not table:
            st.info("Aucune table disponible.")
        else:
            st.subheader(selected)
            st.write(f"Capacité: {table.get('capacity', 0)}")
            guests = table.get("guests") or []
            if not guests:
                st.info("Aucun invité affecté.")
            for idx in range(max(int(table.get("capacity") or 0), len(guests))):
                guest = guests[idx] if idx < len(guests) else None
                if guest:
                    st.markdown(f"**{idx+1}. {escape(str(guest.get('name') or 'Invité'))}** — {guest.get('type') or 'adulte'}")
                    if guest.get("regime"):
                        st.caption(f"Régime: {guest.get('regime')}")
                else:
                    st.markdown(f"{idx+1}. _Place vide_")


if __name__ == "__main__":
    main()
