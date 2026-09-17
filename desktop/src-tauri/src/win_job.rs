// Windows-only: ties the engine sidecar's lifetime to this process via a Job Object with
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE. `CommandChild::kill()` on window close only covers a
// graceful shutdown - if this process dies any other way (crash, Task Manager "End task",
// an installer/update overwriting the running exe), the sidecar was left running with no
// window and no way for the user to notice, until it blocked the next installer with a
// locked DLL. Assigning the sidecar to this job makes Windows kill it automatically the
// moment our own process handle table is torn down, regardless of how that happens.
use std::ptr;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

pub struct JobHandle(HANDLE);

// A job object HANDLE is an opaque kernel reference with no thread affinity - safe to hand
// to another thread, unlike e.g. a window handle.
unsafe impl Send for JobHandle {}
unsafe impl Sync for JobHandle {}

impl Drop for JobHandle {
    fn drop(&mut self) {
        // Closing the last handle to the job triggers KILL_ON_JOB_CLOSE - this only runs if
        // the job is dropped explicitly; on normal process exit Windows tears down our
        // handle table anyway, which has the same effect.
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub fn create_kill_on_close_job() -> Option<JobHandle> {
    unsafe {
        let job = CreateJobObjectW(ptr::null(), ptr::null());
        if job.is_null() {
            return None;
        }

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            CloseHandle(job);
            return None;
        }

        Some(JobHandle(job))
    }
}

pub fn assign_process(job: &JobHandle, pid: u32) {
    unsafe {
        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if process.is_null() {
            return;
        }
        // Best-effort: if this fails the sidecar just falls back to the existing
        // close-on-window-close behaviour, so no error is surfaced to the caller.
        AssignProcessToJobObject(job.0, process);
        CloseHandle(process);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn dropping_the_job_kills_assigned_process() {
        let job = create_kill_on_close_job().expect("job object creation should succeed");

        let mut child = Command::new("cmd")
            .args(["/C", "timeout", "/T", "60"])
            .spawn()
            .expect("spawning a throwaway child process should succeed");
        let pid = child.id();

        assign_process(&job, pid);

        // Dropping the job runs CloseHandle, which (as the only handle to this job, with
        // KILL_ON_JOB_CLOSE set) tears down every process still assigned to it - the same
        // thing that happens implicitly when our own process exits.
        drop(job);

        // TerminateProcess is asynchronous; give the OS a moment to finish tearing the
        // child down before asserting on it.
        thread::sleep(Duration::from_millis(500));

        let exited = child
            .try_wait()
            .expect("try_wait should not error on a still-valid child handle");
        assert!(
            exited.is_some(),
            "child process should have been killed when the job was dropped"
        );
    }
}
