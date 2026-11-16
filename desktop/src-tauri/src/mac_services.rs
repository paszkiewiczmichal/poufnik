//! Finder context menu on macOS (right click on a file → Usługi / Szybkie czynności →
//! Poufnik – …), through macOS Services declared under NSServices in Info.services.plist.
//!
//! macOS calls `<action>:userData:error:` on the services provider with the selected files
//! on a pasteboard; the request then goes through the same queue as the Explorer menu on
//! Windows (shell_actions.rs), so the frontend runs it with the same code.
//!
//! Not in the Mac App Store build: its sandbox cannot write the result next to the file.

use std::sync::OnceLock;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject};
use objc2::{define_class, msg_send, AllocAnyThread};
use objc2_app_kit::{NSApplication, NSPasteboard, NSUpdateDynamicServices};
use objc2_foundation::{MainThreadMarker, NSString, NSURL};
use tauri::AppHandle;

use crate::shell_actions::{queue_shell_action, shell_action_request};

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Paths of the files on a services pasteboard (one `public.file-url` per item).
fn file_paths(pasteboard: &NSPasteboard) -> Vec<String> {
    let file_url = NSString::from_str("public.file-url");
    let Some(items) = pasteboard.pasteboardItems() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| item.stringForType(&file_url))
        .filter_map(|text| NSURL::URLWithString(&text))
        .filter_map(|url| url.path())
        .map(|path| path.to_string())
        .collect()
}

fn run(action: &str, pasteboard: &NSPasteboard) {
    let (Some(app), Some(request)) = (APP.get(), shell_action_request(action, file_paths(pasteboard)))
    else {
        return;
    };
    queue_shell_action(app, request);
}

define_class!(
    // The selectors are the NSMessage values in Info.services.plist.
    #[unsafe(super(NSObject))]
    #[name = "PoufnikServicesProvider"]
    struct ServicesProvider;

    impl ServicesProvider {
        #[unsafe(method(anonymize:userData:error:))]
        fn anonymize(&self, pasteboard: &NSPasteboard, _data: Option<&NSString>, _error: *mut *mut NSString) {
            run("anonymize", pasteboard);
        }

        #[unsafe(method(ocr:userData:error:))]
        fn ocr(&self, pasteboard: &NSPasteboard, _data: Option<&NSString>, _error: *mut *mut NSString) {
            run("ocr", pasteboard);
        }

        #[unsafe(method(markdown:userData:error:))]
        fn markdown(&self, pasteboard: &NSPasteboard, _data: Option<&NSString>, _error: *mut *mut NSString) {
            run("markdown", pasteboard);
        }

        #[unsafe(method(restore:userData:error:))]
        fn restore(&self, pasteboard: &NSPasteboard, _data: Option<&NSString>, _error: *mut *mut NSString) {
            run("restore", pasteboard);
        }

        #[unsafe(method(metadata:userData:error:))]
        fn metadata(&self, pasteboard: &NSPasteboard, _data: Option<&NSString>, _error: *mut *mut NSString) {
            run("metadata", pasteboard);
        }
    }
);

/// Registers the provider; call once from the app's setup (main thread).
pub fn register(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let provider: Retained<ServicesProvider> =
        unsafe { msg_send![ServicesProvider::alloc(), init] };
    let application = NSApplication::sharedApplication(mtm);
    unsafe { application.setServicesProvider(Some(&*provider as &AnyObject)) };
    // NSApplication does not retain the provider: it lives as long as the app.
    std::mem::forget(provider);
    NSUpdateDynamicServices();
}
