mod spa;

use std::path::PathBuf;
use specta::Type;
use tower_http::cors::CorsLayer;

#[derive(Type, serde::Deserialize, serde::Serialize)]
pub struct Info {
    pub name: String,
    pub message: String,
}

#[tokio::main]
async fn main() {
    let users_router =
        rspc::Router::<()>::new().query("list", |t| t(|_ctx, _input: ()| vec![] as Vec<()>));

    let router = rspc::Router::<()>::new()
        .query("version", |t| t(|_ctx, _: ()| {
            println!("Hey!");
            "1.0.1"
        }))
        .query("hello", |t| {
            t(|_ctx, input: Info| async move {
                format!("Hi, {}. I got your message: {}", input.name, input.message)
            })
        })
        .merge("user.", users_router)
        .build()
        .arced();

    router
        .export_ts(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("./src-frontend/types/backend-rpc.d.ts"),
        )
        .unwrap();

    let app = axum::Router::new()
        .nest("/rspc", rspc_axum::endpoint(router, || ()))
        .fallback(spa::serve_spa)
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:4000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
