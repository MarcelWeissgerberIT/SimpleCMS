//! Bounded UTF-8 JSON ABI. The host owns calls; no WASI, network or filesystem imports.
use std::sync::atomic::{AtomicU32, Ordering};
const MAX_INPUT: usize = 262_144;
static OUTPUT_LEN: AtomicU32 = AtomicU32::new(0);

#[no_mangle]
pub extern "C" fn qp_alloc(len: u32) -> *mut u8 {
    if len == 0 || len as usize > MAX_INPUT {
        return std::ptr::null_mut();
    }
    Box::into_raw(vec![0u8; len as usize].into_boxed_slice()) as *mut u8
}

/// Only pass allocations returned by qp_alloc or qp_check with their exact length.
#[no_mangle]
pub unsafe extern "C" fn qp_free(ptr: *mut u8, len: u32) {
    if !ptr.is_null() && len > 0 {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            ptr,
            len as usize,
        )));
    }
}

#[no_mangle]
pub unsafe extern "C" fn qp_check(ptr: *const u8, len: u32) -> *mut u8 {
    let run = || -> Result<crate::integration::Response, String> {
        if ptr.is_null() || len == 0 || len as usize > MAX_INPUT {
            return Err("Invalid input length".into());
        }
        let bytes = std::slice::from_raw_parts(ptr, len as usize);
        let request = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        crate::integration::check(request, &crate::QuantumCatalog::builtin())
    };
    let out = match run() {
        Ok(r) => serde_json::to_vec(&r).unwrap(),
        Err(error) => serde_json::to_vec(&serde_json::json!({"error":error})).unwrap(),
    }
    .into_boxed_slice();
    OUTPUT_LEN.store(out.len() as u32, Ordering::Relaxed);
    Box::into_raw(out) as *mut u8
}

#[no_mangle]
pub extern "C" fn qp_output_len() -> u32 {
    OUTPUT_LEN.load(Ordering::Relaxed)
}
