const cp = require('child_process');
const path = require('path');

let winapi;
try {
  winapi = require('winapi-bindings');
} catch (err) {}

async function createIPC(usePipe, id, onExit, onStdout, containerName) {
  // it does actually get named .exe on linux as well
  const exeName = 'ModInstallerIPC.exe';

  const cwd = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'dist');
  const exePath = path.join(cwd, exeName);

  const args = [id];
  if (usePipe) {
    args.push('--pipe');
  }

  if ((winapi !== undefined) && (containerName !== undefined)) {
    return new Promise((resolve, reject) => {
      // in case the container wasn't cleaned up before
      try {
        winapi.DeleteAppContainer(containerName);
        winapi.CreateAppContainer(containerName, 'FOMOD', 'Container for fomod installers');
        process.on('exit', () => {
          winapi.DeleteAppContainer(containerName);
        });
        try {
          winapi.GrantAppContainer(containerName, cwd, 'file_object', ['generic_execute', 'generic_read', 'list_directory']);
        } catch (err) {
          // I don't get this. This is apparantly required in development builds or .net will complain it can't read
          // the directory with the main exe.
          // In release builds when running from program files it's ok for this to not be called or to fail. why???
        }
        winapi.GrantAppContainer(containerName, `\\\\?\\pipe\\${id}`, 'named_pipe', ['all_access']);
        winapi.GrantAppContainer(containerName, `\\\\?\\pipe\\${id}_reply`, 'named_pipe', ['all_access']);

        const pid = winapi.RunInContainer(containerName, `${exePath} ${args.join(' ')}`, cwd, onExit, onStdout);
        resolve(pid);
      } catch (err) {
        reject(err);
      }
    });
  } else {
    return new Promise((resolve, reject) => {
      const proc = cp.spawn(path.join(__dirname, 'dist', exeName), args)
        .on('error', err => {
          reject?.(err);
          resolve = reject = undefined;
        })
        .on('exit', (code, signal) => {
          if (code === 0x80131700) {
            reject?.(new Error('No compatible .Net Framework, you need .Net framework 4.6 or newer'));
          } else if (code !== null) {
            reject?.(new Error(`Failed to run fomod installer. Errorcode ${code.toString(16)}`));
          } else {
            reject?.(new Error(`The fomod installer was terminated. Signal: ${signal}`));
          }
          resolve = reject = undefined;
          onExit(code);
        });

      proc.stdout.on('data', dat => dat.toString());
      proc.stderr.on('data', dat => dat.toString());

      // resolve slightly delayed to allow the error event to be triggered if the process fails to
      // start. Unfortunately cp.spawn seems to flip a coin on whether it reports events at all or not.
      setTimeout(() => {
        if ((proc.exitCode !== null) && (proc.exitCode !== 0)) {
          reject?.(new Error('Failed to spawn fomod installer'));
        } else {
          resolve?.(proc.pid);
        }
        resolve = reject = undefined;
      }, 100);
    });
  }
}

module.exports = {
  __esModule: true,
  createIPC,
};
