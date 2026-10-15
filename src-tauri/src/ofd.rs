use base64::Engine;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use zip::ZipArchive;

/// Maximum size (in bytes) for a single extracted part.
const MAX_XML_BYTES: u64 = 40 * 1024 * 1024;
const MAX_RES_BYTES: u64 = 40 * 1024 * 1024;

/// The extracted contents of an OFD (GB/T 33190) package.
///
/// `files` holds every XML part keyed by its in-package path (e.g.
/// `Doc_0/Document.xml`); `resources` holds binary assets (images/fonts) as
/// data URIs. The webview parses the XML and renders each page to SVG.
#[derive(Serialize)]
pub struct OfdPackage {
    pub files: HashMap<String, String>,
    pub resources: HashMap<String, String>,
}

/// Decode a base64 payload and parse it as an OFD package.
pub fn open_from_b64(b64: &str) -> Result<OfdPackage, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("无法解码文件数据: {e}"))?;
    open_from_bytes(&bytes)
}

/// Read a file from disk and parse it as an OFD package.
pub fn open_from_path(path: &str) -> Result<OfdPackage, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("无法读取文件: {e}"))?;
    open_from_bytes(&bytes)
}

/// Parse OFD package bytes (a ZIP archive) into an [`OfdPackage`].
pub fn open_from_bytes(bytes: &[u8]) -> Result<OfdPackage, String> {
    let mut zip = match ZipArchive::new(std::io::Cursor::new(bytes)) {
        Ok(z) => z,
        Err(e) => return Err(format!("不是有效的 OFD/ZIP 文件: {e}")),
    };

    let mut files: HashMap<String, String> = HashMap::new();
    let mut resources: HashMap<String, String> = HashMap::new();
    let mut has_entry = false;

    for i in 0..zip.len() {
        let mut file = match zip.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        if file.is_dir() {
            continue;
        }
        let name = normalize_name(file.name());
        let lower = name.to_lowercase();

        if lower.ends_with(".xml") {
            if file.size() > MAX_XML_BYTES {
                continue;
            }
            let mut s = String::new();
            if file.read_to_string(&mut s).is_ok() {
                if lower == "ofd.xml" {
                    has_entry = true;
                }
                files.insert(name, s);
            }
        } else if is_asset(&lower) {
            if file.size() > MAX_RES_BYTES {
                continue;
            }
            let mut buf = Vec::new();
            if file.read_to_end(&mut buf).is_ok() {
                let mime = mime_from_name(&lower);
                let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
                resources.insert(name, format!("data:{mime};base64,{encoded}"));
            }
        }
    }

    if !has_entry {
        return Err("未找到 OFD.xml，可能不是有效的 OFD 文档".to_string());
    }

    Ok(OfdPackage { files, resources })
}

/// Normalize a zip entry name to forward slashes without a leading slash.
fn normalize_name(name: &str) -> String {
    let n = name.replace('\\', "/");
    n.trim_start_matches('/').to_string()
}

fn is_asset(lower: &str) -> bool {
    const EXT: &[&str] = &[
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff", ".ttf", ".otf", ".woff",
        ".woff2",
    ];
    EXT.iter().any(|e| lower.ends_with(e))
}

fn mime_from_name(lower: &str) -> &'static str {
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".bmp") {
        "image/bmp"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".tif") || lower.ends_with(".tiff") {
        "image/tiff"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".ttf") {
        "font/ttf"
    } else if lower.ends_with(".otf") {
        "font/otf"
    } else if lower.ends_with(".woff") {
        "font/woff"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else {
        "application/octet-stream"
    }
}
