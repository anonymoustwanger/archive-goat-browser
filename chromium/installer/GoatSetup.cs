// GoatBrowserSetup.exe: the one Goat Browser installer (C# 5, .NET Framework 4.6.2+).
//
// It lists the Goat versions published on GitHub (newest first), downloads the
// chosen version's package (GoatBrowser-<version>-windows-x64.exe), checks it and
// installs it silently. The same file works for every version, so
// releases/latest/download/GoatBrowserSetup.exe is a permanent download link.
//
// The screen is Goat's own setup UI (ui\*.html, shown in WebView2, which comes
// with Windows 10 and 11). Without WebView2 it falls back to a plain window.
// WebView2's DLLs and the UI are embedded in the exe and unpacked to %TEMP%.

using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Goat Browser setup")]
[assembly: AssemblyProduct("Goat Browser")]
[assembly: AssemblyVersion("1.1.0.0")]

namespace Goat
{
    class Release
    {
        public string Version;
        public string Url;
        public long Size;
        public string Sha256; // empty when GitHub didn't give one
        public bool Latest;

        public override string ToString() { return "Goat " + Version + (Latest ? "  (newest)" : ""); }
    }

    // ------------------------------------------------------------------ engine
    // Finding, downloading and installing versions. Callbacks run on the UI thread.
    class Engine
    {
        const string Repo = "anonymoustwanger/goat-browser";
        static readonly Regex Package = new Regex("^GoatBrowser-(\\d+\\.\\d+\\.\\d+)-windows-x64\\.exe$", RegexOptions.IgnoreCase);
        public static readonly string AppDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Goat Browser", "Application");

        public List<Release> Versions = new List<Release>();
        WebClient download;
        string tempFile;

        public static string InstalledVersion()
        {
            try
            {
                string manifest = Path.Combine(AppDir, "goat", "ext", "goat", "manifest.json");
                if (!File.Exists(Path.Combine(AppDir, "chrome.exe")) || !File.Exists(manifest)) return null;
                Match m = Regex.Match(File.ReadAllText(manifest), "\"version\"\\s*:\\s*\"([0-9.]+)\"");
                return m.Success ? m.Groups[1].Value : null;
            }
            catch { return null; }
        }

        public static int Compare(string a, string b)
        {
            try { return new Version(a).CompareTo(new Version(b)); } catch { return string.CompareOrdinal(a, b); }
        }

        public Release Find(string version)
        {
            foreach (Release r in Versions) if (r.Version == version) return r;
            return null;
        }

        static WebClient NewClient()
        {
            WebClient c = new WebClient();
            c.Headers[HttpRequestHeader.UserAgent] = "GoatBrowserSetup";
            c.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";
            return c;
        }

        public void LoadVersions(Action ok, Action<string> fail)
        {
            WebClient c = NewClient();
            c.DownloadStringCompleted += delegate(object s, DownloadStringCompletedEventArgs e)
            {
                c.Dispose();
                if (e.Error != null) { fail("Couldn't reach GitHub to get the list of versions. Check your connection."); return; }
                string why;
                try { why = Parse(e.Result); }
                catch (Exception) { why = "Couldn't read the version list from GitHub."; }
                if (why != null) fail(why); else ok();
            };
            // GOAT_SETUP_API: a different release list, for testing.
            string api = Environment.GetEnvironmentVariable("GOAT_SETUP_API");
            c.DownloadStringAsync(new Uri(string.IsNullOrEmpty(api) ? "https://api.github.com/repos/" + Repo + "/releases?per_page=50" : api));
        }

        string Parse(string json)
        {
            JavaScriptSerializer js = new JavaScriptSerializer();
            js.MaxJsonLength = int.MaxValue;
            List<Release> found = new List<Release>();
            foreach (object o in (IEnumerable)js.DeserializeObject(json))
            {
                Dictionary<string, object> rel = o as Dictionary<string, object>;
                if (rel == null || Equals(rel["draft"], true) || Equals(rel["prerelease"], true)) continue;
                foreach (object ao in (IEnumerable)rel["assets"])
                {
                    Dictionary<string, object> a = (Dictionary<string, object>)ao;
                    Match m = Package.Match(Convert.ToString(a["name"]));
                    if (!m.Success) continue;
                    Release r = new Release();
                    r.Version = m.Groups[1].Value;
                    r.Url = Convert.ToString(a["browser_download_url"]);
                    r.Size = Convert.ToInt64(a["size"]);
                    object digest;
                    string d = a.TryGetValue("digest", out digest) ? Convert.ToString(digest) : "";
                    r.Sha256 = d.StartsWith("sha256:") ? d.Substring(7).ToLowerInvariant() : "";
                    found.Add(r);
                }
            }
            if (found.Count == 0) return "No Goat versions are published yet. Try again later.";
            found.Sort(delegate(Release x, Release y) { return Compare(y.Version, x.Version); });
            found[0].Latest = true;
            Versions = found;
            return null;
        }

        // progress(step, percent 0-100)
        public void Install(Release r, bool desktop, bool makeDefault, Action<string, int> progress, Action ok, Action<string> fail)
        {
            string installed = InstalledVersion();
            bool goingBack = installed != null && Compare(r.Version, installed) < 0;
            if (goingBack && GoatRunning()) { fail("Close all Goat Browser windows, then click Try again."); return; }

            tempFile = Path.Combine(Path.GetTempPath(), "GoatBrowser-" + r.Version + "-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
            progress("Downloading Goat " + r.Version + "…", 0);
            download = NewClient();
            download.DownloadProgressChanged += delegate(object s, DownloadProgressChangedEventArgs e)
            {
                long total = e.TotalBytesToReceive > 0 ? e.TotalBytesToReceive : r.Size;
                int pct = total > 0 ? (int)Math.Min(100, e.BytesReceived * 100 / total) : 0;
                progress("Downloading Goat " + r.Version + "…  " + (e.BytesReceived / 1048576) + " of " + (total / 1048576) + " MB", pct * 80 / 100);
            };
            download.DownloadFileCompleted += delegate(object s, AsyncCompletedEventArgs e)
            {
                download.Dispose();
                download = null;
                if (e.Cancelled) { Cleanup(); return; }
                if (e.Error != null) { Cleanup(); fail("The download stopped. Check your connection and try again."); return; }
                progress("Installing Goat " + r.Version + "…", 85);
                RunPackage(r, goingBack, desktop, makeDefault, progress, ok, fail);
            };
            download.DownloadFileAsync(new Uri(r.Url), tempFile);
        }

        void RunPackage(Release r, bool goingBack, bool desktop, bool makeDefault, Action<string, int> progress, Action ok, Action<string> fail)
        {
            BackgroundWorker w = new BackgroundWorker();
            w.DoWork += delegate(object s, DoWorkEventArgs e)
            {
                FileInfo info = new FileInfo(tempFile);
                if (r.Size > 0 && info.Length != r.Size) { e.Result = "The download was incomplete. Try again."; return; }
                if (r.Sha256.Length > 0 && Sha256(tempFile) != r.Sha256) { e.Result = "The download didn't match the published file, so it wasn't installed."; return; }
                if (goingBack) RemoveInstalled();
                ProcessStartInfo psi = new ProcessStartInfo(tempFile, "/S");
                psi.UseShellExecute = false;
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit();
                    if (p.ExitCode != 0) { e.Result = "Setup couldn't finish (error " + p.ExitCode + "). Close Goat if it's open and try again."; return; }
                }
                string shortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Goat Browser.lnk");
                if (!desktop) { try { File.Delete(shortcut); } catch { } }
                e.Result = null;
            };
            w.RunWorkerCompleted += delegate(object s, RunWorkerCompletedEventArgs e)
            {
                Cleanup();
                string error = e.Error != null ? "Setup couldn't start: " + e.Error.Message : e.Result as string;
                if (error != null) { fail(error); return; }
                progress("Done", 100);
                if (makeDefault) { try { Process.Start("ms-settings:defaultapps"); } catch { } }
                ok();
            };
            w.RunWorkerAsync();
        }

        public bool Busy { get { return download != null; } }

        public void Cancel()
        {
            if (download != null) download.CancelAsync();
        }

        // Chromium's own setup won't install over a newer version, so remove the
        // installed one first (the profile in User Data is kept).
        static void RemoveInstalled()
        {
            try
            {
                foreach (string dir in Directory.GetDirectories(AppDir))
                {
                    string setup = Path.Combine(dir, "Installer", "setup.exe");
                    if (!File.Exists(setup)) continue;
                    ProcessStartInfo psi = new ProcessStartInfo(setup, "--uninstall --force-uninstall");
                    psi.UseShellExecute = false;
                    using (Process p = Process.Start(psi)) p.WaitForExit(120000);
                    return;
                }
            }
            catch { }
        }

        public static bool GoatRunning()
        {
            string prefix = AppDir.TrimEnd('\\') + "\\";
            foreach (Process p in Process.GetProcessesByName("chrome"))
            {
                try { if (p.MainModule.FileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return true; }
                catch { }
                finally { p.Dispose(); }
            }
            return false;
        }

        public static void Launch()
        {
            try { Process.Start(Path.Combine(AppDir, "chrome.exe")); } catch { }
        }

        static string Sha256(string file)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream f = File.OpenRead(file))
                return BitConverter.ToString(sha.ComputeHash(f)).Replace("-", "").ToLowerInvariant();
        }

        void Cleanup()
        {
            try { if (tempFile != null && File.Exists(tempFile)) File.Delete(tempFile); } catch { }
        }
    }

    // ----------------------------------------------------------- Goat's UI
    class WebSetupForm : Form
    {
        readonly Engine engine = new Engine();
        readonly string uiDir;
        readonly string dataDir;
        Microsoft.Web.WebView2.WinForms.WebView2 web;
        bool installing;

        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        public WebSetupForm(string uiDir, string dataDir)
        {
            this.uiDir = uiDir;
            this.dataDir = dataDir;
            Text = "Goat Browser setup";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Program.Dark() ? Color.FromArgb(16, 18, 20) : Color.FromArgb(238, 240, 243);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            float scale;
            using (Graphics g = CreateGraphics()) scale = g.DpiX / 96f;
            ClientSize = new Size((int)(640 * scale), (int)(460 * scale));

            web = new Microsoft.Web.WebView2.WinForms.WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = BackColor;
            Controls.Add(web);
            Load += async delegate
            {
                try
                {
                    Microsoft.Web.WebView2.Core.CoreWebView2Environment env =
                        await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, dataDir, null);
                    await web.EnsureCoreWebView2Async(env);
                    Microsoft.Web.WebView2.Core.CoreWebView2 core = web.CoreWebView2;
                    core.Settings.AreDevToolsEnabled = false;
                    core.Settings.AreDefaultContextMenusEnabled = false;
                    core.Settings.IsZoomControlEnabled = false;
                    core.Settings.IsStatusBarEnabled = false;
                    core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                    core.SetVirtualHostNameToFolderMapping("setup.goat", uiDir, Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.Allow);
                    core.WebMessageReceived += OnMessage;
                    core.NewWindowRequested += delegate(object s, Microsoft.Web.WebView2.Core.CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
                    core.Navigate("https://setup.goat/index.html");
                }
                catch (Exception e)
                {
                    MessageBox.Show(this, "Goat setup couldn't open its window: " + e.Message, "Goat Browser setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    Close();
                }
            };
            FormClosing += delegate(object s, FormClosingEventArgs e)
            {
                if (installing && !engine.Busy) { e.Cancel = true; return; } // the install itself must finish
                engine.Cancel();
            };
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ClassStyle |= 0x20000; // drop shadow
                cp.Style |= 0x20000;      // minimize box (taskbar click minimizes)
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int round = 2; // Windows 11 rounded corners
            try { DwmSetWindowAttribute(Handle, 33, ref round, 4); } catch { }
        }

        void Post(Dictionary<string, object> msg)
        {
            if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsString(new JavaScriptSerializer().Serialize(msg));
        }

        static Dictionary<string, object> Msg(string type)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["type"] = type;
            return d;
        }

        void Error(string message)
        {
            installing = false;
            Dictionary<string, object> m = Msg("error");
            m["message"] = message;
            Post(m);
        }

        void OnMessage(object sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
        {
            Dictionary<string, object> m;
            try { m = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(e.TryGetWebMessageAsString()); }
            catch { return; }
            object t;
            string type = m.TryGetValue("type", out t) ? Convert.ToString(t) : "";
            switch (type)
            {
                case "drag":
                    ReleaseCapture();
                    SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); // WM_NCLBUTTONDOWN, HTCAPTION
                    break;
                case "minimize":
                    WindowState = FormWindowState.Minimized;
                    break;
                case "close":
                    Close();
                    break;
                case "launch":
                    Engine.Launch();
                    Close();
                    break;
                case "versions":
                    engine.LoadVersions(SendVersions, Error);
                    break;
                case "install":
                {
                    Release r = engine.Find(Convert.ToString(m["version"]));
                    if (r == null) { Error("That version isn't available any more."); break; }
                    installing = true;
                    engine.Install(r, Equals(m["desktop"], true), Equals(m["makeDefault"], true),
                        delegate(string step, int pct)
                        {
                            Dictionary<string, object> p = Msg("progress");
                            p["step"] = step;
                            p["pct"] = pct;
                            Post(p);
                        },
                        delegate
                        {
                            installing = false;
                            Dictionary<string, object> d = Msg("done");
                            d["version"] = r.Version;
                            Post(d);
                        },
                        Error);
                    break;
                }
            }
        }

        void SendVersions()
        {
            Dictionary<string, object> m = Msg("versions");
            m["installed"] = Engine.InstalledVersion();
            List<object> list = new List<object>();
            foreach (Release r in engine.Versions)
            {
                Dictionary<string, object> v = new Dictionary<string, object>();
                v["version"] = r.Version;
                v["size"] = r.Size;
                v["latest"] = r.Latest;
                list.Add(v);
            }
            m["versions"] = list;
            Post(m);
        }
    }

    // ------------------------------------------------- plain fallback window
    class PlainSetupForm : Form
    {
        readonly Engine engine = new Engine();
        readonly Label status = new Label();
        readonly Label note = new Label();
        readonly ComboBox versions = new ComboBox();
        readonly ProgressBar bar = new ProgressBar();
        readonly Button action = new Button();
        string installed = Engine.InstalledVersion();
        bool done;
        bool working;

        public PlainSetupForm()
        {
            Text = "Goat Browser setup";
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 9.75f);
            BackColor = Color.White;
            ClientSize = new Size(480, 300);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            Label title = new Label();
            title.Text = "Install Goat Browser";
            title.Font = new Font("Segoe UI", 18f, FontStyle.Bold);
            title.SetBounds(28, 20, 424, 40);
            Label label = new Label();
            label.Text = "Version";
            label.SetBounds(30, 74, 420, 20);
            versions.DropDownStyle = ComboBoxStyle.DropDownList;
            versions.SetBounds(30, 96, 420, 28);
            versions.Enabled = false;
            versions.SelectedIndexChanged += delegate { Describe(); };
            note.ForeColor = Color.DimGray;
            note.SetBounds(30, 132, 420, 40);
            bar.SetBounds(30, 180, 420, 10);
            bar.Visible = false;
            status.SetBounds(30, 196, 420, 38);
            status.Text = "Looking for versions…";
            action.Text = "Install";
            action.SetBounds(240, 248, 130, 34);
            action.Enabled = false;
            action.Click += delegate { OnAction(); };
            Button close = new Button();
            close.Text = "Close";
            close.SetBounds(380, 248, 70, 34);
            close.Click += delegate { Close(); };
            Controls.AddRange(new Control[] { title, label, versions, note, bar, status, action, close });
            Shown += delegate { Reload(); };
            FormClosing += delegate(object s, FormClosingEventArgs e) { if (working && !engine.Busy) e.Cancel = true; else engine.Cancel(); };
        }

        void Reload()
        {
            status.Text = "Looking for versions…";
            engine.LoadVersions(delegate
            {
                versions.Items.Clear();
                foreach (Release r in engine.Versions) versions.Items.Add(r);
                versions.SelectedIndex = 0;
                versions.Enabled = true;
                action.Enabled = true;
                status.Text = "";
                Describe();
            }, Fail);
        }

        void Describe()
        {
            Release r = versions.SelectedItem as Release;
            if (r == null || working) return;
            if (installed == null) { action.Text = "Install"; note.Text = (r.Size / 1048576) + " MB download."; return; }
            int c = Engine.Compare(r.Version, installed);
            action.Text = c > 0 ? "Update" : c == 0 ? "Reinstall" : "Go back";
            note.Text = "You have Goat " + installed + "." + (c < 0 ? " Older versions may reset your browsing data. Close Goat first." : " Your profile is kept.");
        }

        void Fail(string message)
        {
            working = false;
            bar.Visible = false;
            status.ForeColor = Color.Firebrick;
            status.Text = message;
            action.Text = "Try again";
            action.Enabled = true;
            versions.Enabled = versions.Items.Count > 0;
        }

        void OnAction()
        {
            if (done) { Engine.Launch(); Close(); return; }
            if (versions.Items.Count == 0) { Reload(); return; }
            Release r = versions.SelectedItem as Release;
            if (r == null) return;
            working = true;
            action.Enabled = false;
            versions.Enabled = false;
            status.ForeColor = ForeColor;
            bar.Visible = true;
            engine.Install(r, true, false,
                delegate(string step, int pct) { status.Text = step; bar.Value = Math.Max(0, Math.Min(100, pct)); },
                delegate
                {
                    working = false;
                    done = true;
                    installed = r.Version;
                    bar.Visible = false;
                    status.ForeColor = Color.SeaGreen;
                    status.Text = "Goat " + r.Version + " is installed.";
                    action.Text = "Open Goat";
                    action.Enabled = true;
                },
                Fail);
        }
    }

    // ------------------------------------------------------------- startup
    static class Program
    {
        static string unpackDir;

        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        public static bool Dark()
        {
            try
            {
                object v = Microsoft.Win32.Registry.GetValue("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "AppsUseLightTheme", 1);
                return v is int && (int)v == 0;
            }
            catch { return true; }
        }

        // Unpacks the embedded UI and WebView2 files into %TEMP%\GoatSetup-<version>.
        static void Unpack()
        {
            Assembly me = Assembly.GetExecutingAssembly();
            unpackDir = Path.Combine(Path.GetTempPath(), "GoatSetup-" + me.GetName().Version);
            foreach (string name in me.GetManifestResourceNames())
            {
                // Resource names: "ui/<file>" or "lib/<file>"
                string target = Path.Combine(unpackDir, name.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (Stream src = me.GetManifestResourceStream(name))
                {
                    if (File.Exists(target) && new FileInfo(target).Length == src.Length && !name.StartsWith("ui/")) continue; // DLL may be in use by another copy
                    using (FileStream dst = File.Create(target)) src.CopyTo(dst);
                }
            }
            AppDomain.CurrentDomain.AssemblyResolve += delegate(object s, ResolveEventArgs e)
            {
                string file = Path.Combine(unpackDir, "lib", new AssemblyName(e.Name).Name + ".dll");
                return File.Exists(file) ? Assembly.LoadFrom(file) : null;
            };
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        static bool WebView2Ready()
        {
            try
            {
                Microsoft.Web.WebView2.Core.CoreWebView2Environment.SetLoaderDllFolderPath(Path.Combine(unpackDir, "lib"));
                return !string.IsNullOrEmpty(Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString());
            }
            catch { return false; }
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        static Form WebForm()
        {
            return new WebSetupForm(Path.Combine(unpackDir, "ui"), Path.Combine(unpackDir, "webview-data"));
        }

        [STAThread]
        static void Main(string[] args)
        {
            try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)12288; } // TLS 1.2 + 1.3
            catch (NotSupportedException) { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; }
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool plain = Array.IndexOf(args, "--plain") >= 0;
            try { Unpack(); } catch { plain = true; }
            Application.Run(!plain && WebView2Ready() ? WebForm() : new PlainSetupForm());
        }
    }
}
