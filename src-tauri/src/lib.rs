mod connections;
mod oss;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(oss::OssState::default())
        .manage(oss::PreviewState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            oss::connect_oss,
            oss::disconnect_oss,
            oss::list_objects,
            oss::put_object,
            oss::start_multipart_upload,
            oss::upload_part,
            oss::complete_multipart_upload,
            oss::abort_multipart_upload,
            oss::signed_object_url,
            oss::copy_object,
            oss::set_object_acl,
            oss::get_object_headers,
            oss::set_object_headers,
            oss::restore_object,
            oss::create_symlink,
            oss::delete_object,
            oss::download_object,
            oss::preview_image,
            oss::cancel_preview,
            connections::saved_connections,
            connections::save_connection,
            connections::forget_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OSS Browser Neo");
}
