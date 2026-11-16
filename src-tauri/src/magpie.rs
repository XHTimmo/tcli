use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Route {
    id: u64,
    time: String,
    agent: String,
    session: String,
    folder: String,
    model: String,
    provider: String,
    served: String,
    done: bool,
    status: u16,
    bytes: u64,
    ms: u64,
    ttft: u64,
    order: Vec<Provider>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
struct Provider {
    id: String,
    name: String,
    model: String,
}

#[derive(Deserialize)]
struct Trace {
    routes: Vec<Route>,
}

// Keep requests local and bounded; read only routing metadata from Magpie.
#[tauri::command]
pub async fn magpie_routes() -> Result<Vec<Route>, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(crate::err)?;
    let trace = client
        .get("http://127.0.0.1:3425/v1/magpie/trace")
        .send().await.map_err(crate::err)?
        .error_for_status().map_err(crate::err)?
        .json::<Trace>().await.map_err(crate::err)?;
    let mut seen = std::collections::HashSet::new();
    Ok(trace.routes.into_iter().rev()
        .filter(|r| seen.insert(if r.session.is_empty() { r.id.to_string() } else { r.session.clone() }))
        .take(12).collect())
}
