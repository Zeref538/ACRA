"""
streamlit_app.py
----------------
Martinez, John Andrei M. " Streamlit Integration

Phase 1 final deliverable. Full re-encoding pipeline wired to a
Streamlit UI for live demo and validation.

Run with:
    streamlit run streamlit_app.py
"""

import streamlit as st
import numpy as np
from PIL import Image
import base64
import io
import time
import os
from html import escape

try:
    _RESAMPLE_BICUBIC = Image.Resampling.BICUBIC
    _RESAMPLE_NEAREST = Image.Resampling.NEAREST
except AttributeError:
    _RESAMPLE_BICUBIC = Image.BICUBIC
    _RESAMPLE_NEAREST = Image.NEAREST

# Trained model weights " both sit one directory above this file
_PROJ_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BEST_MODEL_PATH  = os.path.join(_PROJ_DIR, "best.pt")
_COCO_MODEL_PATH  = os.path.join(_PROJ_DIR, "yolov8m.pt")

# "" Page config """""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""
st.set_page_config(
    page_title="CVD Re-Encoding Pipeline",
    page_icon="CVD",
    layout="wide",
    initial_sidebar_state="expanded",
)

# "" Custom CSS """"""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Exo:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&display=swap');

/*  Design Tokens  */
:root {
    --c-primary:      #1E40AF;
    --c-primary-lt:   #3B82F6;
    --c-accent:       #D97706;
    --c-text:         #1E3A8A;
    --c-text-body:    #1e293b;
    --c-text-2:       #475569;
    --c-text-3:       #94a3b8;
    --c-bg:           #F8FAFC;
    --c-surface:      #ffffff;
    --c-muted:        #E9EEF6;
    --c-border:       #DBEAFE;
    --c-border-2:     #bfdbfe;
    --c-success:      #16a34a;
    --c-success-bg:   #f0fdf4;
    --c-success-bd:   #bbf7d0;
    --c-info-bg:      #eff6ff;
    --c-info-bd:      #bfdbfe;
    --c-error:        #dc2626;
    --c-warning:      #b45309;
    --radius:         8px;
    --transition:     160ms ease;
    --font-ui:        'Exo', system-ui, sans-serif;
    --font-mono:      'Roboto Mono', 'Courier New', monospace;
}

/*  Typography  */
.main-header {
    font-family: var(--font-ui);
    font-size: 1.875rem;
    font-weight: 700;
    color: var(--c-text);
    letter-spacing: -0.025em;
    line-height: 1.25;
    margin-bottom: 0.375rem;
}
.sub-header {
    font-family: var(--font-ui);
    font-size: 0.9375rem;
    color: var(--c-text-2);
    line-height: 1.6;
    margin-bottom: 1.5rem;
}

/*  Phase badge  */
.phase-badge {
    display: inline-block;
    background: var(--c-primary);
    color: #fff;
    padding: 0.2rem 0.55rem;
    border-radius: 4px;
    font-family: var(--font-ui);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
}

/*  Processing card  */
.processing-card {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    background: var(--c-info-bg);
    border: 1px solid var(--c-info-bd);
    border-left: 4px solid var(--c-primary-lt);
    border-radius: var(--radius);
    padding: 0.875rem 1rem;
    margin: 0.75rem 0 0.5rem;
}
.processing-loader {
    width: 1.625rem;
    height: 1.625rem;
    border: 2.5px solid var(--c-border-2);
    border-top-color: var(--c-primary-lt);
    border-radius: 50%;
    animation: processing-spin 0.75s linear infinite;
    flex: 0 0 auto;
}
.processing-complete .processing-loader {
    display: grid;
    place-items: center;
    border-color: var(--c-success);
    background: var(--c-success);
    color: #fff;
    animation: none;
    font-size: 0.65rem;
    font-weight: 800;
}
.processing-complete .processing-loader::after { content: "OK"; }
.processing-complete {
    background: var(--c-success-bg);
    border-color: var(--c-success-bd);
    border-left-color: var(--c-success);
}
.processing-title {
    font-family: var(--font-ui);
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--c-text-body);
    line-height: 1.2;
}
.processing-detail {
    font-size: 0.875rem;
    color: var(--c-text-2);
    margin-top: 0.125rem;
}

/*  Cluster image component  */
.hover-cluster-card { margin-bottom: 0.75rem; }
.hover-cluster-title {
    font-family: var(--font-ui);
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--c-text-body);
    margin-bottom: 0.35rem;
}
.hover-cluster-frame {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius);
    background: #0f172a;
    line-height: 0;
    cursor: pointer;
    outline: none;
    -webkit-tap-highlight-color: transparent;
}
.hover-cluster-frame:focus-visible {
    box-shadow: 0 0 0 3px var(--c-primary-lt);
}
.hover-cluster-base,
.hover-cluster-overlay {
    display: block;
    width: 100%;
    height: auto;
}
.hover-cluster-overlay {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity var(--transition);
    pointer-events: none;
}
.hover-cluster-frame:hover .hover-cluster-overlay,
.hover-cluster-frame.pinned .hover-cluster-overlay { opacity: 1; }
.hover-cluster-legend {
    position: absolute;
    left: 0.6rem;
    right: 0.6rem;
    bottom: 0.6rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    padding: 0.45rem 0.5rem;
    border-radius: 6px;
    background: rgba(15, 24, 39, 0.88);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    color: #fff;
    font-size: 0.72rem;
    line-height: 1.1;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity var(--transition), transform var(--transition);
    pointer-events: none;
}
.hover-cluster-frame:hover .hover-cluster-legend,
.hover-cluster-frame.pinned .hover-cluster-legend {
    opacity: 1;
    transform: translateY(0);
}
.hover-cluster-count { font-weight: 700; margin-right: 0.15rem; }
.hover-cluster-swatch {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 3px;
    border: 1px solid rgba(255,255,255,0.6);
    flex: 0 0 auto;
}
.hover-cluster-more { color: #bfdbfe; font-weight: 600; }
.hover-cluster-caption {
    color: var(--c-text-2);
    font-size: 0.8125rem;
    line-height: 1.4;
    margin-top: 0.375rem;
}
.hover-cluster-hint {
    color: var(--c-text-3);
    font-size: 0.75rem;
    margin-top: 0.25rem;
    user-select: none;
}

/*  Metric cards  */
.metric-card {
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-left: 4px solid var(--c-success);
    border-radius: var(--radius);
    padding: 1rem;
    margin-bottom: 0.5rem;
}
.metric-fail { border-left-color: var(--c-error) !important; }
.metric-warn { border-left-color: var(--c-accent) !important; }

/*  Empty state  */
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 3rem 2rem 2rem;
    color: var(--c-text-2);
}
.empty-state-icon {
    font-size: 2.75rem;
    line-height: 1;
    margin-bottom: 1rem;
    opacity: 0.55;
}
.empty-state-title {
    font-family: var(--font-ui);
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--c-text-body);
    margin-bottom: 0.5rem;
}
.empty-state-body {
    font-size: 0.9375rem;
    color: var(--c-text-2);
    max-width: 420px;
    line-height: 1.65;
}

/*  Focus rings  */
a:focus-visible,
button:focus-visible,
[role="button"]:focus-visible,
[tabindex]:focus-visible {
    outline: 2px solid var(--c-primary-lt) !important;
    outline-offset: 2px;
}

/*  Keyframes  */
@keyframes processing-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
    .processing-loader { animation: none; border-top-color: var(--c-primary-lt); }
    .hover-cluster-overlay,
    .hover-cluster-legend { transition: none; }
}
</style>
""", unsafe_allow_html=True)


# "" Import pipeline """""""""""""""""""""""""""""""""""""""""""""""""""""""""""
def load_pipeline():
    """Import pipeline modules. (Cache disabled for live editing)"""
    from pipeline import run_full_pipeline
    from pipeline.cvd_simulation import simulate_cvd
    from pipeline.normalization import normalize_array
    return run_full_pipeline, simulate_cvd, normalize_array

try:
    run_full_pipeline, simulate_cvd, normalize_array = load_pipeline()
    pipeline_loaded = True
except Exception as e:
    pipeline_loaded = False
    pipeline_error = str(e)


@st.cache_data(show_spinner=False, max_entries=8)
def run_pipeline_cached(file_bytes, severity, cvd_type):
    """Run the full pipeline, cached on the uploaded image bytes + CVD params.

    Streamlit re-runs the whole script on every widget interaction; caching here
    means clicking a download button, "Redo", etc. returns the previous result
    instantly instead of reprocessing the entire pipeline.
    """
    img = np.array(Image.open(io.BytesIO(file_bytes)).convert("RGB"), dtype=np.uint8)
    return run_full_pipeline(
        img,
        severity,
        cvd_type,
        n_clusters=None,
        use_segmentation=True,
        seg_model=_BEST_MODEL_PATH,
        seg_conf=0.25,
        seg_soft=3.5,
        seg_clusters_per_roi=None,
        max_proc_pixels=650_000,
    )


def render_processing_state(container, percent, title, detail, complete=False):
    """Render the animated processing card used while the pipeline runs."""
    card_class = "processing-card processing-complete" if complete else "processing-card"
    container.markdown(
        f"""
        <div class="{card_class}" role="status" aria-live="polite">
            <div class="processing-loader"></div>
            <div>
                <div class="processing-title">{escape(title)} ({percent}%)</div>
                <div class="processing-detail">{escape(detail)}</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def image_to_data_uri(image_array):
    """Convert a uint8 RGB/RGBA image array into a PNG data URI."""
    buf = io.BytesIO()
    Image.fromarray(image_array).save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def resize_for_preview(image_array, max_pixels=700_000, resample=_RESAMPLE_BICUBIC):
    """Resize large arrays for browser display without changing download outputs."""
    h, w = image_array.shape[:2]
    if h * w <= max_pixels:
        return image_array
    scale = (max_pixels / float(h * w)) ** 0.5
    new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
    return np.array(Image.fromarray(image_array).resize(new_size, resample=resample))


def render_hover_cluster_image(base_image, overlay_image, title, caption, element_id, legend):
    """Render an image that reveals the cluster overlay on hover or click/tap."""
    if overlay_image is None:
        if title:
            st.markdown(f"**{escape(title)}**")
        st.image(base_image, width="stretch")
        if caption:
            st.caption(caption)
        return

    base_uri = image_to_data_uri(base_image)
    overlay_uri = image_to_data_uri(overlay_image)
    legend = legend or []
    visible_legend = legend[:12]
    more_count = max(0, len(legend) - len(visible_legend))

    swatch_parts = []
    for item in visible_legend:
        tip_name = item.get("label") or ("Cluster " + str(item["index"]))
        tip = escape(tip_name + ": " + f"{item['percent']:.1f}%")
        color = escape(item["color"])
        swatch_parts.append(
            '<span class="hover-cluster-swatch" title="' + tip + '" '
            'style="background:' + color + '"></span>'
        )
    swatches = "".join(swatch_parts)
    more_label = f'<span class="hover-cluster-more">+{more_count} more</span>' if more_count else ""
    has_labels = any("label" in item for item in legend)
    region_label = "regions" if has_labels else "clusters"
    count_label = f"{len(legend)} {region_label}"
    legend_html = (
        f'<div class="hover-cluster-legend" aria-hidden="true">'
        f'<span class="hover-cluster-count">{count_label}</span>'
        f'{swatches}{more_label}'
        f'</div>'
    )
    title_html = f'<div class="hover-cluster-title">{escape(title)}</div>' if title else ""
    caption_html = f'<div class="hover-cluster-caption">{escape(caption)}</div>' if caption else ""
    hint_html = (
        '<div class="hover-cluster-hint" aria-hidden="true">'
        'Hover or tap image to reveal cluster overlay'
        '</div>'
    ) if legend else ""

    toggle_js = (
        "var f=this;"
        "f.classList.toggle('pinned');"
        "f.setAttribute('aria-pressed',f.classList.contains('pinned'));"
    )
    keyboard_js = (
        "if(event.key==='Enter'||event.key===' '){"
        "event.preventDefault();"
        "var f=this;"
        "f.classList.toggle('pinned');"
        "f.setAttribute('aria-pressed',f.classList.contains('pinned'));}"
    )

    st.markdown(
        (
            f'<div class="hover-cluster-card" id="{escape(element_id)}">'
            f'{title_html}'
            f'<div class="hover-cluster-frame"'
            f' role="button" tabindex="0"'
            f' aria-label="{escape(count_label)}  tap to toggle overlay"'
            f' aria-pressed="false"'
            f' onclick="{toggle_js}"'
            f' onkeydown="{keyboard_js}">'
            f'<img class="hover-cluster-base" src="{base_uri}"'
            f' alt="{escape(title) if title else "processed image"}">'
            f'<img class="hover-cluster-overlay" src="{overlay_uri}"'
            f' alt="Cluster overlay: {escape(count_label)}">'
            f'{legend_html}'
            f'</div>'
            f'{caption_html}'
            f'{hint_html}'
            f'</div>'
        ),
        unsafe_allow_html=True,
    )


# 
#  Sidebar
# 

with st.sidebar:
    st.markdown('<span class="phase-badge">PHASE 1</span>', unsafe_allow_html=True)
    st.markdown("## CVD Re-Encoding Pipeline")
    st.markdown("---")

    # Hardcoded CVD parameters for now
    cvd_type = "deutan"
    severity = 1.0

    st.markdown("###  Pipeline Settings")
    st.info(
        "YOLOv8 segmentation is always on using best.pt. "
        "FCM clusters per region are adaptive, and mask edge softness is fixed. "
        "Only red/green text is re-encoded; other text stays unchanged."
    )

    cluster_count = None
    use_segmentation = True
    _YOLO_MODEL_PATH = _BEST_MODEL_PATH
    seg_conf = 0.25
    seg_soft = 3.5
    seg_clusters_per_roi = None

    st.markdown("---")
    st.markdown("### About")
    st.markdown("""
    This tool applies **LCH re-encoding** to make images
    more distinguishable for CVD users without noticeably
    altering colors for normal-vision viewers.

    **Pipeline:**
    1. Normalize (sRGB ' Linear)
    2. CVD Simulation (Machado 2009)
    3. CIELAB Conversion
    4. Fuzzy C-Means Clustering
    5. Conflict Detection (CIEDE2000)
    6. LCH Re-Encoding (dual-objective)
    7. Membership Reconstruction
    8. Metrics Validation
    """)

    st.markdown("---")
    st.markdown("**Team:** Martinez  Gallo  Balcarse  Torres")


# 
#  Main content
# 

st.markdown('<h1 class="main-header">CVD Color Re-Encoding</h1>', unsafe_allow_html=True)
st.markdown('<p class="sub-header">Upload an image to simulate color vision deficiency and apply LCH re-encoding correction.</p>', unsafe_allow_html=True)

if not pipeline_loaded:
    st.error(f" Pipeline failed to load: `{pipeline_error}`")
    st.info("Ensure all pipeline modules are in the `pipeline/` directory and dependencies are installed.")
    st.stop()

# "" File uploader """""""""""""""""""""""""""""""""""""""""""""""""""""""""""""
if "upload_key" not in st.session_state:
    st.session_state.upload_key = 0

uploaded_file = st.file_uploader(
    "Upload an image",
    type=["png", "jpg", "jpeg", "bmp", "tiff"],
    help="Upload any image to process through the re-encoding pipeline.",
    key=f"uploader_{st.session_state.upload_key}",
)

if uploaded_file is None:
    st.markdown("""
    <div class="empty-state">
        <div class="empty-state-icon">&#x1F5BC;</div>
        <div class="empty-state-title">Upload an image to get started</div>
        <div class="empty-state-body">
            Supports PNG, JPG, BMP, and TIFF. The pipeline will simulate color
            vision deficiency and apply LCH re-encoding correction automatically.
        </div>
    </div>
    """, unsafe_allow_html=True)

    with st.expander("How to use this tool"):
        st.markdown("""
        1. **Upload** an image using the uploader above
        2. Wait for the pipeline to finish  it runs automatically
        3. Review the four-panel comparison and validation metrics
        4. Download the corrected image or export metrics as CSV
        """)

    st.stop()


# "" Process uploaded image """"""""""""""""""""""""""""""""""""""""""""""""""""
img_pil = Image.open(uploaded_file).convert("RGB")
img_np = np.array(img_pil, dtype=np.uint8)
uploaded_preview = resize_for_preview(img_np, resample=_RESAMPLE_BICUBIC)

# Preview columns
col_preview, col_spacer = st.columns([2, 1])
with col_preview:
    st.image(uploaded_preview, caption=f"Uploaded: {uploaded_file.name}  ({img_np.shape[1]}{img_np.shape[0]})", width="stretch")
with col_spacer:
    st.markdown("")
    if st.button("Redo", width="stretch"):
        st.rerun()

st.markdown("---")
# "" Run pipeline """""""""""""""""""""""""""""""""""""""""""""""""""""""
processing_state = st.empty()
progress_bar = st.progress(0, text="Starting pipeline...")

try:
    t_start = time.time()
    render_processing_state(processing_state, 5, "Processing image", "Running the re-encoding pipeline...")

    with st.spinner("Processing image..."):
        # Cached on the uploaded image bytes — repeat interactions are instant.
        corrected_uint8, metrics = run_pipeline_cached(
            uploaded_file.getvalue(), severity, cvd_type
        )

    sim_srgb = metrics.get("_sim_srgb")
    if sim_srgb is None:
        sim_uint8 = np.zeros_like(img_np)
    else:
        sim_uint8 = (np.clip(sim_srgb, 0.0, 1.0) * 255.0).astype(np.uint8)

    t_elapsed = time.time() - t_start
    auto_k = metrics.get('auto_clusters', cluster_count)
    render_processing_state(
        processing_state,
        100,
        "Done",
        f"Finished in {t_elapsed:.1f}s.",
        complete=True,
    )
    progress_bar.progress(100, text=f"Done in {t_elapsed:.1f}s")

    # "" Display results """"""""""""""""""""""""""""""""""""""""""""""""
    st.success(
        f"Pipeline completed in **{t_elapsed:.2f}s** - **{auto_k} clusters** "
        f"{'(auto-detected)' if cluster_count is None else '(manual)'}"
    )

    st.markdown("## Results")
    cluster_overlay = metrics.get("cluster_overlay_uint8")
    cluster_legend = metrics.get("cluster_legend", [])
    cvd_label = "Deuteranopia" if cvd_type == "deutan" else "Protanopia"
    seg_class_names = metrics.get("seg_class_names")
    img_preview = resize_for_preview(img_np, resample=_RESAMPLE_BICUBIC)
    sim_preview = resize_for_preview(sim_uint8, resample=_RESAMPLE_BICUBIC)
    corrected_preview = resize_for_preview(corrected_uint8, resample=_RESAMPLE_BICUBIC)
    overlay_preview = (
        resize_for_preview(cluster_overlay, resample=_RESAMPLE_NEAREST)
        if cluster_overlay is not None else None
    )

    # "" Row 1: Original + CVD Simulation """"""""""""""""""""""""""""""
    col1, col2 = st.columns(2)
    with col1:
        st.markdown("**Original**")
        render_hover_cluster_image(img_preview, overlay_preview, "", "", "cluster-original", cluster_legend)
        st.caption("Original - as seen by normal vision.")

    with col2:
        st.markdown("**CVD Simulation of Original**")
        render_hover_cluster_image(sim_preview, overlay_preview, "", "", "cluster-cvd-original", cluster_legend)
        cvd_label = "Deuteranopia" if cvd_type == "deutan" else "Protanopia"
        st.caption(f"{cvd_label} simulation of the original (severity={severity:.2f})")

    st.markdown("")

    # "" Row 2: Re-encoded + Re-encoded under CVD """"""""""""""""""""""
    # Simulate the corrected image through CVD so users can see the
    # actual perceptual improvement for CVD viewers.
    from pipeline.normalization import normalize_array as _norm
    from pipeline.cvd_simulation import simulate_cvd as _sim_cvd
    corrected_linear_for_sim = _norm(corrected_preview)
    sim_of_corrected_float   = _sim_cvd(corrected_linear_for_sim, severity, cvd_type)
    sim_of_corrected_uint8   = (np.clip(sim_of_corrected_float, 0, 1) * 255).astype(np.uint8)

    col3, col4 = st.columns(2)
    with col3:
        st.markdown("**Re-encoded Output**")
        render_hover_cluster_image(corrected_preview, overlay_preview, "", "", "cluster-reencoded", cluster_legend)
        st.caption("LCH re-encoded - modified for CVD users, natural for others.")

    with col4:
        st.markdown("**CVD Simulation of Re-encoded**")
        render_hover_cluster_image(sim_of_corrected_uint8, overlay_preview, "", "", "cluster-cvd-reencoded", cluster_legend)
        st.caption(f"How the re-encoded image looks to a {cvd_label.lower()} viewer.")

    # "" Metrics """"""""""""""""""""""""""""""""""""""""""""""""""""""""
    st.markdown("---")
    st.markdown("## Validation Metrics")

    m1, m2, m3, m4 = st.columns(4)

    de_imp     = metrics.get("de_improvement", 0)
    de_after   = metrics.get("de_after_mean", 0)
    res_rate   = metrics.get("conflict_resolution_rate", 0)
    natural    = metrics.get("naturalness_preservation", 0)
    n_total    = metrics.get("n_conflicts_total", 0)
    pass_de    = metrics.get("pass_de_improvement", False)

    with m1:
        # Show de_after_mean alongside raw improvement so mild-conflict
        # cases (where pairs started near threshold) read correctly.
        if n_total == 0:
            de_label = "no conflicts"
            de_delta = "image already accessible"
        elif de_after >= 20:
            de_label = f"+{de_imp:.1f}  (after: {de_after:.1f})"
            de_delta = "after >= 20 all pairs distinct"
        else:
            de_label = f"{de_imp:.2f}"
            de_delta = f"after: {de_after:.1f}  target after >= 20"
        st.metric(
            label=f"{'OK' if pass_de else 'WARN'} dE Improvement",
            value=de_label,
            delta=de_delta,
            delta_color="normal" if pass_de else "inverse"
        )

    with m2:
        status = "OK" if res_rate > 0.8 else "WARN"
        st.metric(
            label=f"{status} Conflict Resolution",
            value=f"{res_rate*100:.1f}%",
            delta=f"{metrics.get('n_conflicts_resolved',0)}/{n_total} pairs",
            delta_color="normal" if res_rate > 0.8 else "inverse"
        )

    with m3:
        status = "OK" if natural < 12 else "WARN"
        st.metric(
            label=f"{status} Naturalness (dE_orig)",
            value=f"{natural:.2f}",
            delta=f"Target < 12",
            delta_color="normal" if natural < 12 else "inverse"
        )

    with m4:
        st.metric(
            label="Clusters Used",
            value=f"{auto_k}",
            delta="Auto-detected" if cluster_count is None else "Manual override",
            delta_color="off"
        )

    # "" Pass/fail summary """"""""""""""""""""""""""""""""""""""""""""""
    all_pass = all([
        metrics.get("pass_de_improvement", False),
        metrics.get("pass_resolution_rate", False),
        metrics.get("pass_naturalness", False),
    ])

    if all_pass:
        st.success(" All Phase 1 validation targets met.")
    else:
        failing = []
        if not metrics.get("pass_de_improvement"):  failing.append("dE Improvement")
        if not metrics.get("pass_resolution_rate"): failing.append("Conflict Resolution")
        if not metrics.get("pass_naturalness"):     failing.append("Naturalness")
        st.warning(f" Targets not met: {', '.join(failing)}")

    # "" Timing breakdown """""""""""""""""""""""""""""""""""""""""""""""
    stage_timings = metrics.get("_stage_timings")
    if stage_timings:
        with st.expander("Timing breakdown (per stage)"):
            total = sum(stage_timings.values())
            for stage, secs in sorted(stage_timings.items(), key=lambda kv: -kv[1]):
                pct = (secs / total * 100.0) if total > 0 else 0.0
                st.markdown(f"- **{escape(stage)}** - {secs*1000:.0f} ms ({pct:.0f}%)")
            st.caption(f"Pipeline compute total: {total*1000:.0f} ms")

    # "" Download section """""""""""""""""""""""""""""""""""""""""""""""
        st.markdown("---")
        st.markdown("## Downloads")
    
        dl1, dl2, dl3 = st.columns(3)
    
        with dl1:
            corrected_pil = Image.fromarray(corrected_uint8)
            buf = io.BytesIO()
            corrected_pil.save(buf, format="PNG")
            st.download_button(
                " Download Corrected Image",
                data=buf.getvalue(),
                file_name=f"corrected_{uploaded_file.name}",
                mime="image/png",
                width="stretch"
            )
    
        with dl2:
            sim_pil = Image.fromarray(sim_uint8)
            buf2 = io.BytesIO()
            sim_pil.save(buf2, format="PNG")
            st.download_button(
                " Download CVD Simulation",
                data=buf2.getvalue(),
                file_name=f"simulated_{uploaded_file.name}",
                mime="image/png",
                width="stretch"
            )
    
        with dl3:
            # Export metrics as CSV
            csv_lines = ["metric,value,target,pass"]
            csv_lines.append(f"de_improvement,{de_imp:.4f},>15,{metrics.get('pass_de_improvement')}")
            csv_lines.append(f"conflict_resolution_rate,{res_rate:.4f},>0.8,{metrics.get('pass_resolution_rate')}")
            csv_lines.append(f"naturalness_preservation,{natural:.4f},<12,{metrics.get('pass_naturalness')}")
            csv_lines.append(f"n_conflicts_total,{metrics.get('n_conflicts_total',0)},,")
            csv_lines.append(f"n_conflicts_resolved,{metrics.get('n_conflicts_resolved',0)},,")
            csv_lines.append(f"cvd_type,{cvd_type},,")
            csv_lines.append(f"severity,{severity},,")
    
            st.download_button(
                " Download Metrics CSV",
                data="\n".join(csv_lines),
                file_name=f"metrics_{uploaded_file.name.split('.')[0]}",
                mime="text/csv",
                width="stretch"
            )

except Exception as e:
    processing_state.empty()
    progress_bar.empty()
    st.error(f" Pipeline error: `{str(e)}`")
    with st.expander("Full traceback"):
        import traceback
        st.code(traceback.format_exc())
