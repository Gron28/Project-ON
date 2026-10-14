{
    "targets": [
        {
            "target_name": "addon",
            "sources": ["src/main.cpp", "src/window-list.cpp", "src/loopback-capture.cpp", "src/loopback-capture-wrapper.cpp"],
            'include_dirs': [
                "src\\include",
                "<!(node -p \"require('node-addon-api').include_dir\")"
            ],
            "libraries": [
                "mfplat.lib",
                "mfuuid.lib",
                "Mmdevapi.lib"
            ],
            "dependencies": [
                "<!(node -p \"require('node-addon-api').gyp\")"
            ],
            "cflags!": ["-fno-exceptions"],
            "cflags_cc!": ["-fno-exceptions"],
            "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
        }
    ]
}
