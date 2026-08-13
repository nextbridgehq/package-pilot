use package_pilot::commands::project::get_directory_size;

#[tokio::test]
async fn test_get_directory_size_smoke() {
    let cargo_toml_dir = std::env::current_dir().unwrap().to_string_lossy().to_string();
    let result = get_directory_size(cargo_toml_dir).await;
    
    assert!(result.is_ok(), "get_directory_size should return Ok for a valid directory");
    let size = result.unwrap();
    assert!(size > 0.0, "Directory size should be greater than 0");
}
