//! COM plumbing: class factory, the root "Poufnik" command and its sub-commands.

use std::ffi::c_void;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

use windows::core::{implement, Interface, Ref, BOOL, GUID, HRESULT, PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_NOTIMPL, E_POINTER, HMODULE,
    S_FALSE, S_OK,
};
use windows::Win32::System::Com::{CoTaskMemFree, IBindCtx, IClassFactory, IClassFactory_Impl};
use windows::Win32::System::LibraryLoader::{
    GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
    GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
};
use windows::Win32::UI::Shell::{
    IEnumExplorerCommand, IEnumExplorerCommand_Impl, IExplorerCommand, IExplorerCommand_Impl,
    IShellItemArray, SHStrDupW, ECF_DEFAULT, ECF_HASSUBCOMMANDS, ECS_ENABLED, ECS_HIDDEN,
    SIGDN_FILESYSPATH,
};

use crate::{action_applies, COMMANDS};

/// CLSID of the root command in the Microsoft Store package (AppxManifest.xml.template).
pub const CLSID_POUFNIK_MENU: GUID = GUID::from_u128(0xa2ba5662_b3cb_43d1_aa89_84265f213e7c);
/// CLSID of the same command in the GitHub installer's identity package
/// (shell-menu/sparse/AppxManifest.xml.template). A separate value, so the two packages never
/// declare the same COM class when both are installed.
pub const CLSID_POUFNIK_MENU_DIRECT: GUID =
    GUID::from_u128(0xd2c5f856_c78a_4afa_bc32_6259d0e125c7);

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
static LIVE_OBJECTS: AtomicUsize = AtomicUsize::new(0);

struct LiveObject;
impl LiveObject {
    fn new() -> Self {
        LIVE_OBJECTS.fetch_add(1, Ordering::SeqCst);
        LiveObject
    }
}
impl Drop for LiveObject {
    fn drop(&mut self) {
        LIVE_OBJECTS.fetch_sub(1, Ordering::SeqCst);
    }
}

fn dup(text: &str) -> windows::core::Result<PWSTR> {
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe { SHStrDupW(PCWSTR(wide.as_ptr())) }
}

/// Poufnik.exe next to this DLL in the package.
fn poufnik_exe() -> Option<PathBuf> {
    let mut module = HMODULE::default();
    unsafe {
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            PCWSTR(poufnik_exe as *const () as *const u16),
            &mut module,
        )
        .ok()?;
    }
    let mut buffer = vec![0u16; 32_768];
    let length = unsafe { GetModuleFileNameW(Some(module), &mut buffer) } as usize;
    if length == 0 {
        return None;
    }
    let dll = PathBuf::from(String::from_utf16_lossy(&buffer[..length]));
    Some(dll.parent()?.join("Poufnik.exe"))
}

fn selected_paths(items: &Option<IShellItemArray>) -> Vec<String> {
    let Some(items) = items else {
        return Vec::new();
    };
    let count = unsafe { items.GetCount() }.unwrap_or(0);
    let mut paths = Vec::new();
    for index in 0..count {
        let Ok(item) = (unsafe { items.GetItemAt(index) }) else {
            continue;
        };
        let Ok(name) = (unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }) else {
            continue;
        };
        if let Ok(path) = unsafe { name.to_string() } {
            paths.push(path);
        }
        unsafe { CoTaskMemFree(Some(name.0 as *const c_void)) };
    }
    paths
}

#[implement(IExplorerCommand)]
struct RootCommand {
    _live: LiveObject,
}

impl IExplorerCommand_Impl for RootCommand_Impl {
    fn GetTitle(&self, _items: Ref<IShellItemArray>) -> windows::core::Result<PWSTR> {
        dup("Poufnik")
    }

    fn GetIcon(&self, _items: Ref<IShellItemArray>) -> windows::core::Result<PWSTR> {
        let exe = poufnik_exe().ok_or_else(|| windows::core::Error::from(E_FAIL))?;
        dup(&format!("{},0", exe.display()))
    }

    fn GetToolTip(&self, _items: Ref<IShellItemArray>) -> windows::core::Result<PWSTR> {
        Err(E_NOTIMPL.into())
    }

    fn GetCanonicalName(&self) -> windows::core::Result<GUID> {
        Ok(CLSID_POUFNIK_MENU)
    }

    fn GetState(&self, items: Ref<IShellItemArray>, _slow: BOOL) -> windows::core::Result<u32> {
        let paths = selected_paths(&items.cloned());
        let any = COMMANDS
            .iter()
            .any(|(action, _)| action_applies(action, &paths));
        Ok(if any {
            ECS_ENABLED.0 as u32
        } else {
            ECS_HIDDEN.0 as u32
        })
    }

    fn Invoke(
        &self,
        _items: Ref<IShellItemArray>,
        _ctx: Ref<IBindCtx>,
    ) -> windows::core::Result<()> {
        Err(E_NOTIMPL.into())
    }

    fn GetFlags(&self) -> windows::core::Result<u32> {
        Ok(ECF_HASSUBCOMMANDS.0 as u32)
    }

    fn EnumSubCommands(&self) -> windows::core::Result<IEnumExplorerCommand> {
        Ok(SubCommands {
            next: AtomicUsize::new(0),
            _live: LiveObject::new(),
        }
        .into())
    }
}

#[implement(IExplorerCommand)]
struct SubCommand {
    index: usize,
    _live: LiveObject,
}

impl IExplorerCommand_Impl for SubCommand_Impl {
    fn GetTitle(&self, _items: Ref<IShellItemArray>) -> windows::core::Result<PWSTR> {
        dup(COMMANDS[self.index].1)
    }

    fn GetIcon(&self, _items: Ref<IShellItemArray>) -> windows::core::Result<PWSTR> {
        Err(E_NOTIMPL.into())
    }

    fn GetToolTip(&self, _items: Ref<IShellItemArray>) -> windows::core::Result<PWSTR> {
        Err(E_NOTIMPL.into())
    }

    fn GetCanonicalName(&self) -> windows::core::Result<GUID> {
        Err(E_NOTIMPL.into())
    }

    fn GetState(&self, items: Ref<IShellItemArray>, _slow: BOOL) -> windows::core::Result<u32> {
        let paths = selected_paths(&items.cloned());
        Ok(if action_applies(COMMANDS[self.index].0, &paths) {
            ECS_ENABLED.0 as u32
        } else {
            ECS_HIDDEN.0 as u32
        })
    }

    fn Invoke(
        &self,
        items: Ref<IShellItemArray>,
        _ctx: Ref<IBindCtx>,
    ) -> windows::core::Result<()> {
        let paths = selected_paths(&items.cloned());
        if paths.is_empty() {
            return Ok(());
        }
        let exe = poufnik_exe().ok_or_else(|| windows::core::Error::from(E_FAIL))?;
        Command::new(exe)
            .arg("--poufnik-action")
            .arg(COMMANDS[self.index].0)
            .args(&paths)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|_| E_FAIL.into())
    }

    fn GetFlags(&self) -> windows::core::Result<u32> {
        Ok(ECF_DEFAULT.0 as u32)
    }

    fn EnumSubCommands(&self) -> windows::core::Result<IEnumExplorerCommand> {
        Err(E_NOTIMPL.into())
    }
}

#[implement(IEnumExplorerCommand)]
struct SubCommands {
    next: AtomicUsize,
    _live: LiveObject,
}

impl IEnumExplorerCommand_Impl for SubCommands_Impl {
    fn Next(
        &self,
        count: u32,
        commands: *mut Option<IExplorerCommand>,
        fetched: *mut u32,
    ) -> HRESULT {
        if commands.is_null() {
            return E_POINTER;
        }
        let mut written = 0u32;
        while written < count {
            let index = self.next.load(Ordering::SeqCst);
            if index >= COMMANDS.len() {
                break;
            }
            self.next.store(index + 1, Ordering::SeqCst);
            let command: IExplorerCommand = SubCommand {
                index,
                _live: LiveObject::new(),
            }
            .into();
            unsafe { commands.add(written as usize).write(Some(command)) };
            written += 1;
        }
        if !fetched.is_null() {
            unsafe { *fetched = written };
        }
        if written == count {
            S_OK
        } else {
            S_FALSE
        }
    }

    fn Skip(&self, count: u32) -> windows::core::Result<()> {
        self.next.fetch_add(count as usize, Ordering::SeqCst);
        Ok(())
    }

    fn Reset(&self) -> windows::core::Result<()> {
        self.next.store(0, Ordering::SeqCst);
        Ok(())
    }

    fn Clone(&self) -> windows::core::Result<IEnumExplorerCommand> {
        Ok(SubCommands {
            next: AtomicUsize::new(self.next.load(Ordering::SeqCst)),
            _live: LiveObject::new(),
        }
        .into())
    }
}

#[implement(IClassFactory)]
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(
        &self,
        outer: Ref<windows::core::IUnknown>,
        iid: *const GUID,
        object: *mut *mut c_void,
    ) -> windows::core::Result<()> {
        if object.is_null() || iid.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { *object = std::ptr::null_mut() };
        if outer.is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let command: IExplorerCommand = RootCommand {
            _live: LiveObject::new(),
        }
        .into();
        unsafe { command.query(iid, object).ok() }
    }

    fn LockServer(&self, _lock: BOOL) -> windows::core::Result<()> {
        Ok(())
    }
}

#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(
    clsid: *const GUID,
    iid: *const GUID,
    object: *mut *mut c_void,
) -> HRESULT {
    if clsid.is_null() || iid.is_null() || object.is_null() {
        return E_POINTER;
    }
    *object = std::ptr::null_mut();
    if *clsid != CLSID_POUFNIK_MENU && *clsid != CLSID_POUFNIK_MENU_DIRECT {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let factory: IClassFactory = Factory.into();
    factory.query(iid, object)
}

#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    if LIVE_OBJECTS.load(Ordering::SeqCst) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}
