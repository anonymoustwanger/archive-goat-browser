// goat-host: Goat Browser's native helper (C# 5, .NET Framework 4).
//
//   goat-host.exe chrome-extension://...   native messaging host for the Goat extension
//   goat-host.exe --tor-daemon             runs Tor while Goat is open (one per user)
//   goat-host.exe --tor-window             opens a Tor window: a separate Goat instance
//                                          with Tor as a fixed proxy and a throwaway profile
//
// It lives in <Goat>\Application\goat\ next to tor\ and ext\.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Goat Browser helper")]
[assembly: System.Reflection.AssemblyProduct("Goat Browser")]
[assembly: System.Reflection.AssemblyVersion("5.0.0.0")]

namespace Goat
{
    static class Host
    {
        const string Version = "5.0.0";
        const int SocksPort = 9250;
        const int ControlPort = 9251;
        const string ExtensionId = "hpgdgeidplcdilgooojfjcglokfpdmof";
        const string DaemonMutex = "Local\\GoatBrowserTorDaemon";

        static readonly string GoatDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        static readonly string AppDir = Path.GetDirectoryName(GoatDir);
        static readonly string ChromeExe = Path.Combine(AppDir, "chrome.exe");
        static readonly string TorDir = Path.Combine(GoatDir, "tor");
        static readonly string TorExe = Path.Combine(TorDir, "tor", "tor.exe");
        static readonly string DataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Goat Browser", "Tor");
        static readonly string ErrorFile = Path.Combine(DataRoot, "error.txt");

        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        static readonly object WriteLock = new object();
        static Stream stdout;

        [STAThread]
        static int Main(string[] args)
        {
            try
            {
                if (args.Contains("--tor-daemon")) return RunDaemon();
                if (args.Contains("--tor-window")) return RunTorWindow();
                return RunNativeMessaging();
            }
            catch (Exception e)
            {
                Log("fatal: " + e);
                return 1;
            }
        }

        // ------------------------------------------------------------ messaging
        static int RunNativeMessaging()
        {
            Stream stdin = Console.OpenStandardInput();
            stdout = Console.OpenStandardOutput();
            byte[] len = new byte[4];
            while (true)
            {
                if (!ReadFull(stdin, len, 4)) return 0;
                int n = BitConverter.ToInt32(len, 0);
                if (n <= 0 || n > 1024 * 1024) return 1;
                byte[] body = new byte[n];
                if (!ReadFull(stdin, body, n)) return 0;
                Dictionary<string, object> msg;
                try { msg = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body)); }
                catch { Send(Err("bad message")); continue; }
                object reply;
                try { reply = Handle(msg); }
                catch (Exception e) { reply = Err(e.Message); }
                if (reply != null) Send(reply);
            }
        }

        static bool ReadFull(Stream s, byte[] buf, int n)
        {
            int got = 0;
            while (got < n)
            {
                int r = s.Read(buf, got, n - got);
                if (r <= 0) return false;
                got += r;
            }
            return true;
        }

        static void Send(object o)
        {
            byte[] body = Encoding.UTF8.GetBytes(Json.Serialize(o));
            lock (WriteLock)
            {
                stdout.Write(BitConverter.GetBytes(body.Length), 0, 4);
                stdout.Write(body, 0, body.Length);
                stdout.Flush();
            }
        }

        static Dictionary<string, object> Ok()
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["ok"] = true;
            return d;
        }

        static Dictionary<string, object> Err(string message)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["error"] = message;
            return d;
        }

        static object Handle(Dictionary<string, object> msg)
        {
            string cmd = msg.ContainsKey("cmd") ? Convert.ToString(msg["cmd"]) : "";
            switch (cmd)
            {
                case "status":
                {
                    Dictionary<string, object> d = Ok();
                    d["version"] = Version;
                    string vf = Path.Combine(TorDir, "VERSION");
                    d["torVersion"] = File.Exists(vf) ? File.ReadAllText(vf).Trim() : "";
                    d["torInstalled"] = File.Exists(TorExe);
                    return d;
                }
                case "tor-watch":
                {
                    string why = EnsureDaemon();
                    if (why != null) { Send(TorStatus("error", 0, why)); return null; }
                    Thread t = new Thread(WatchLoop);
                    t.IsBackground = true;
                    t.Start();
                    return null;
                }
                case "newnym":
                {
                    string r = Control("SIGNAL NEWNYM");
                    return r != null && r.StartsWith("250") ? (object)Ok() : Err("Tor isn't running");
                }
                case "tor-window":
                {
                    if (!File.Exists(ChromeExe)) return Err("Goat Browser not found next to the helper");
                    string why = EnsureDaemon();
                    if (why != null) return Err(why);
                    Spawn(Path.Combine(GoatDir, "goat-host.exe"), "--tor-window");
                    return Ok();
                }
                case "write-switches":
                    return WriteSwitches(msg.ContainsKey("lines") ? msg["lines"] as IEnumerable : null);
                case "uninstall":
                    return Uninstall();
                default:
                    return Err("unknown command");
            }
        }

        static Dictionary<string, object> TorStatus(string state, int progress, string error)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["type"] = "tor";
            d["state"] = state;
            d["progress"] = progress;
            d["error"] = error ?? "";
            return d;
        }

        static void WatchLoop()
        {
            string last = "";
            DateTime started = DateTime.UtcNow;
            while (true)
            {
                Dictionary<string, object> st = QueryTor(started);
                string key = st["state"] + "|" + st["progress"] + "|" + st["error"];
                try
                {
                    if (key != last) Send(st);
                }
                catch { return; } // browser went away
                last = key;
                Thread.Sleep(Convert.ToString(st["state"]) == "on" ? 5000 : 700);
            }
        }

        static Dictionary<string, object> QueryTor(DateTime since)
        {
            string r = Control("GETINFO status/bootstrap-phase");
            if (r != null)
            {
                Match m = Regex.Match(r, "PROGRESS=(\\d+)");
                int p = m.Success ? int.Parse(m.Groups[1].Value) : 0;
                Match w = Regex.Match(r, "WARN BOOTSTRAP .*?SUMMARY=\"([^\"]*)\"");
                if (p >= 100) return TorStatus("on", 100, "");
                return TorStatus("starting", p, w.Success && (DateTime.UtcNow - since).TotalSeconds > 20 ? "Tor: " + w.Groups[1].Value : "");
            }
            string err = File.Exists(ErrorFile) ? File.ReadAllText(ErrorFile).Trim() : "";
            if (err.Length > 0) return TorStatus("error", 0, err);
            if (!DaemonRunning() && (DateTime.UtcNow - since).TotalSeconds > 10) return TorStatus("error", 0, "Tor stopped");
            return TorStatus("starting", 0, "");
        }

        // ------------------------------------------------------- Tor control
        static string Control(string command)
        {
            try
            {
                string cookieFile = Path.Combine(DataRoot, "data", "control_auth_cookie");
                if (!File.Exists(cookieFile)) return null;
                string cookie = BitConverter.ToString(File.ReadAllBytes(cookieFile)).Replace("-", "");
                using (TcpClient c = new TcpClient())
                {
                    IAsyncResult ar = c.BeginConnect("127.0.0.1", ControlPort, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(1500)) return null;
                    c.EndConnect(ar);
                    c.ReceiveTimeout = 3000;
                    NetworkStream s = c.GetStream();
                    StreamReader rd = new StreamReader(s, Encoding.ASCII);
                    StreamWriter wr = new StreamWriter(s, Encoding.ASCII);
                    wr.NewLine = "\r\n";
                    wr.WriteLine("AUTHENTICATE " + cookie);
                    wr.Flush();
                    if (!(rd.ReadLine() ?? "").StartsWith("250")) return null;
                    wr.WriteLine(command);
                    wr.Flush();
                    StringBuilder sb = new StringBuilder();
                    while (true)
                    {
                        string line = rd.ReadLine();
                        if (line == null) break;
                        sb.AppendLine(line);
                        if (line.Length >= 4 && line[3] == ' ') break; // final line of the reply
                    }
                    wr.WriteLine("QUIT");
                    wr.Flush();
                    return sb.ToString();
                }
            }
            catch
            {
                return null;
            }
        }

        static bool DaemonRunning()
        {
            try
            {
                using (Mutex.OpenExisting(DaemonMutex)) return true;
            }
            catch
            {
                return false;
            }
        }

        // Starts the Tor daemon unless it's running. Returns an error message or null.
        static string EnsureDaemon()
        {
            if (!File.Exists(TorExe)) return "Tor is missing from this Goat install. Reinstall Goat Browser.";
            if (DaemonRunning()) return null;
            try { File.Delete(ErrorFile); } catch { }
            if (!Spawn(Path.Combine(GoatDir, "goat-host.exe"), "--tor-daemon")) return "couldn't start Tor";
            for (int i = 0; i < 30 && !DaemonRunning(); i++) Thread.Sleep(100);
            return null;
        }

        static int RunDaemon()
        {
            bool created;
            using (Mutex mutex = new Mutex(true, DaemonMutex, out created))
            {
                if (!created) return 0; // already running
                Directory.CreateDirectory(Path.Combine(DataRoot, "data"));
                string torrc = Path.Combine(DataRoot, "torrc");
                string geo = Path.Combine(TorDir, "data");
                File.WriteAllText(torrc, string.Join("\n", new string[] {
                    "SocksPort 127.0.0.1:" + SocksPort,
                    "ControlPort 127.0.0.1:" + ControlPort,
                    "CookieAuthentication 1",
                    "DataDirectory " + Path.Combine(DataRoot, "data"),
                    "GeoIPFile " + Path.Combine(geo, "geoip"),
                    "GeoIPv6File " + Path.Combine(geo, "geoip6"),
                    "ClientOnly 1",
                    "AvoidDiskWrites 1",
                    "Log notice file " + Path.Combine(DataRoot, "tor.log"),
                    "__OwningControllerProcess " + Process.GetCurrentProcess().Id,
                }) + "\n");

                Process tor = null;
                int restarts = 0;
                int idle = 0;
                while (true)
                {
                    if (tor == null || tor.HasExited)
                    {
                        if (tor != null)
                        {
                            restarts++;
                            if (restarts > 3)
                            {
                                WriteError("Tor keeps stopping (exit code " + tor.ExitCode + "). See " + Path.Combine(DataRoot, "tor.log"));
                                return 1;
                            }
                        }
                        try
                        {
                            ProcessStartInfo psi = new ProcessStartInfo(TorExe, "-f \"" + torrc + "\"");
                            psi.UseShellExecute = false;
                            psi.CreateNoWindow = true;
                            psi.WorkingDirectory = Path.GetDirectoryName(TorExe);
                            tor = Process.Start(psi);
                        }
                        catch (Exception e)
                        {
                            WriteError("Couldn't start Tor: " + e.Message);
                            return 1;
                        }
                    }
                    Thread.Sleep(5000);
                    idle = GoatRunning() ? 0 : idle + 1;
                    if (idle >= 3)
                    {
                        // Goat closed: stop Tor.
                        try { if (!tor.HasExited) tor.Kill(); } catch { }
                        return 0;
                    }
                }
            }
        }

        static void WriteError(string message)
        {
            try { Directory.CreateDirectory(DataRoot); File.WriteAllText(ErrorFile, message); } catch { }
            Log(message);
        }

        static bool GoatRunning()
        {
            string prefix = AppDir.TrimEnd('\\') + "\\";
            foreach (Process p in Process.GetProcessesByName("chrome"))
            {
                try
                {
                    string file = p.MainModule.FileName;
                    if (file.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return true;
                }
                catch { }
                finally { p.Dispose(); }
            }
            return false;
        }

        // ------------------------------------------------------- Tor window
        static int RunTorWindow()
        {
            if (EnsureDaemon() != null) return 1;
            string profile = Path.Combine(Path.GetTempPath(), "goat-tor-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(profile);
            string[] args = {
                "--user-data-dir=\"" + profile + "\"",
                "--proxy-server=\"socks5://127.0.0.1:" + SocksPort + "\"",
                "--webrtc-ip-handling-policy=disable_non_proxied_udp",
                "--disable-background-networking",
                "--no-first-run",
                "--no-default-browser-check",
                "--new-window",
                "chrome-extension://" + ExtensionId + "/tor.html",
            };
            ProcessStartInfo psi = new ProcessStartInfo(ChromeExe, string.Join(" ", args));
            psi.UseShellExecute = false;
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
            }
            // Wait for the window's helper processes, then delete the throwaway profile.
            for (int i = 0; i < 60; i++)
            {
                Thread.Sleep(1000);
                try
                {
                    if (Directory.Exists(profile)) Directory.Delete(profile, true);
                    break;
                }
                catch { }
            }
            return 0;
        }

        // --------------------------------------------------------- switches
        static readonly HashSet<string> AllowedSwitches = new HashSet<string> {
            "fingerprinting-canvas-image-data-noise",
            "fingerprinting-client-rects-noise",
            "fingerprinting-canvas-measuretext-noise",
            "no-pings",
        };
        static readonly HashSet<string> AllowedFeatures = new HashSet<string> {
            "SpoofWebGLInfo", "RemoveClientHints", "ReducedSystemInfo", "MinimalReferrers",
        };

        static object WriteSwitches(IEnumerable lines)
        {
            if (lines == null) return Err("no lines");
            List<string> keep = new List<string>();
            foreach (object o in lines)
            {
                string line = Convert.ToString(o).Trim();
                Match m = Regex.Match(line, "^--([a-z0-9-]+)(?:=([A-Za-z0-9,]+))?$");
                if (!m.Success) return Err("bad switch " + line);
                string name = m.Groups[1].Value;
                if (name == "enable-features")
                {
                    foreach (string f in m.Groups[2].Value.Split(','))
                        if (!AllowedFeatures.Contains(f)) return Err("feature not allowed: " + f);
                }
                else if (!AllowedSwitches.Contains(name) || m.Groups[2].Success)
                {
                    return Err("switch not allowed: " + name);
                }
                keep.Add(line);
            }
            string file = Path.Combine(GoatDir, "settings.switches");
            string text = "# Written by Goat settings. Read at startup.\r\n" + string.Join("\r\n", keep) + "\r\n";
            string old = File.Exists(file) ? File.ReadAllText(file) : "";
            Dictionary<string, object> d = Ok();
            d["changed"] = old != text;
            if (old != text) File.WriteAllText(file, text);
            return d;
        }

        // -------------------------------------------------------- uninstall
        static object Uninstall()
        {
            foreach (RegistryKey root in new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                using (RegistryKey un = root.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall"))
                {
                    if (un == null) continue;
                    foreach (string name in un.GetSubKeyNames())
                    {
                        using (RegistryKey k = un.OpenSubKey(name))
                        {
                            if (k == null) continue;
                            string display = Convert.ToString(k.GetValue("DisplayName"));
                            string cmd = Convert.ToString(k.GetValue("UninstallString"));
                            if (display != "Goat Browser" || string.IsNullOrEmpty(cmd)) continue;
                            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/d /c \"" + cmd + "\"");
                            psi.UseShellExecute = false;
                            psi.CreateNoWindow = true;
                            Process.Start(psi).Dispose();
                            return Ok();
                        }
                    }
                }
            }
            return Err("Goat Browser isn't registered with Windows");
        }

        // ---------------------------------------------------------- helpers
        static void Log(string line)
        {
            try
            {
                Directory.CreateDirectory(DataRoot);
                File.AppendAllText(Path.Combine(DataRoot, "helper.log"), DateTime.Now.ToString("s") + " " + line + "\r\n");
            }
            catch { }
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct STARTUPINFO
        {
            public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
            public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars;
            public int dwYCountChars; public int dwFillAttribute; public int dwFlags; public short wShowWindow;
            public short cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags,
            IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr h);

        const uint CREATE_NO_WINDOW = 0x08000000;
        const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
        const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;

        // Starts a process that outlives this one (and the browser's job, if any).
        static bool Spawn(string exe, string args)
        {
            foreach (uint flags in new uint[] { CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB, CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP })
            {
                STARTUPINFO si = new STARTUPINFO();
                si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                PROCESS_INFORMATION pi;
                StringBuilder cmd = new StringBuilder("\"" + exe + "\" " + args);
                if (CreateProcess(exe, cmd, IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, GoatDir, ref si, out pi))
                {
                    CloseHandle(pi.hThread);
                    CloseHandle(pi.hProcess);
                    return true;
                }
            }
            Log("spawn failed: " + Marshal.GetLastWin32Error());
            return false;
        }
    }
}
