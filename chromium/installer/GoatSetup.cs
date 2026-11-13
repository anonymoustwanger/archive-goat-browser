// GoatBrowserSetup.exe: the one Goat Browser installer (C# 5, .NET Framework 4.5+, WinForms).
//
// It lists the Goat versions published on GitHub, lets you pick one (newest by
// default), downloads that version's package (GoatBrowser-<version>-windows-x64.exe),
// checks it, and installs it. The same file works for every version, so
// releases/latest/download/GoatBrowserSetup.exe is a permanent download link.

using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Goat Browser setup")]
[assembly: System.Reflection.AssemblyProduct("Goat Browser")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

namespace Goat
{
    class Release
    {
        public string Version;
        public string Url;
        public long Size;
        public string Sha256; // may be empty
        public bool Latest;

        public override string ToString()
        {
            return "Goat " + Version + (Latest ? "  (newest)" : "");
        }
    }

    class SetupForm : Form
    {
        const string Repo = "anonymoustwanger/goat-browser";
        static readonly Regex Package = new Regex("^GoatBrowser-(\\d+\\.\\d+\\.\\d+)-windows-x64\\.exe$", RegexOptions.IgnoreCase);
        static readonly string AppDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Goat Browser", "Application");

        readonly Label title = new Label();
        readonly Label status = new Label();
        readonly Label note = new Label();
        readonly Label versionLabel = new Label();
        readonly ComboBox versions = new ComboBox();
        readonly ProgressBar bar = new ProgressBar();
        readonly Button action = new Button();
        readonly Button close = new Button();

        string installed;
        string tempFile;
        WebClient download;
        enum Mode { Loading, Ready, Working, Done, Failed }
        Mode mode = Mode.Loading;

        public SetupForm()
        {
            Text = "Goat Browser setup";
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 9.75f);
            BackColor = Color.White;
            ForeColor = Color.FromArgb(17, 17, 17);
            ClientSize = new Size(480, 330);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            title.Text = "Install Goat Browser";
            title.Font = new Font("Segoe UI", 18f, FontStyle.Bold);
            title.SetBounds(28, 22, 424, 40);

            Label about = new Label();
            about.Text = "A private, fast browser built on Chromium. Installs just for you, no admin rights needed.";
            about.ForeColor = Color.FromArgb(95, 99, 104);
            about.SetBounds(30, 66, 420, 40);

            versionLabel.Text = "Version";
            versionLabel.SetBounds(30, 118, 420, 20);
            versions.DropDownStyle = ComboBoxStyle.DropDownList;
            versions.SetBounds(30, 140, 420, 28);
            versions.Enabled = false;
            versions.SelectedIndexChanged += delegate { ShowChoice(); };

            note.ForeColor = Color.FromArgb(95, 99, 104);
            note.SetBounds(30, 176, 420, 40);

            bar.SetBounds(30, 222, 420, 10);
            bar.Visible = false;
            status.SetBounds(30, 236, 420, 38);
            status.Text = "Looking for versions…";

            action.Text = "Install";
            action.SetBounds(240, 278, 130, 34);
            action.FlatStyle = FlatStyle.Flat;
            action.BackColor = Color.FromArgb(17, 17, 17);
            action.ForeColor = Color.White;
            action.Enabled = false;
            action.Click += delegate { OnAction(); };
            close.Text = "Close";
            close.SetBounds(380, 278, 70, 34);
            close.FlatStyle = FlatStyle.Flat;
            close.Click += delegate { Close(); };
            AcceptButton = action;

            Controls.AddRange(new Control[] { title, about, versionLabel, versions, note, bar, status, action, close });
            installed = InstalledVersion();
            Shown += delegate { LoadVersions(); };
            FormClosing += OnClosing;
        }

        // ------------------------------------------------------------ state
        static string InstalledVersion()
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

        static int Compare(string a, string b)
        {
            try { return new Version(a).CompareTo(new Version(b)); } catch { return string.CompareOrdinal(a, b); }
        }

        void ShowChoice()
        {
            Release r = versions.SelectedItem as Release;
            if (r == null || mode != Mode.Ready) return;
            string mb = (r.Size / 1048576.0).ToString("0") + " MB download.";
            if (installed == null)
            {
                action.Text = "Install";
                note.Text = mb;
            }
            else
            {
                int c = Compare(r.Version, installed);
                action.Text = c > 0 ? "Update" : c == 0 ? "Reinstall" : "Go back";
                note.Text = "You have Goat " + installed + ". " + mb +
                    (c < 0 ? " Going back to an older version can reset your browsing data." : " Your profile is kept.");
            }
        }

        void Fail(string message)
        {
            mode = Mode.Failed;
            bar.Visible = false;
            status.ForeColor = Color.FromArgb(198, 40, 40);
            status.Text = message;
            action.Text = "Try again";
            action.Enabled = true;
            versions.Enabled = versions.Items.Count > 0;
        }

        void OnAction()
        {
            if (mode == Mode.Done)
            {
                try { Process.Start(Path.Combine(AppDir, "chrome.exe")); } catch { }
                Close();
            }
            else if (mode == Mode.Failed && versions.Items.Count == 0) LoadVersions();
            else if (mode == Mode.Ready || mode == Mode.Failed) StartInstall();
        }

        void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (mode == Mode.Working)
            {
                if (download == null) { e.Cancel = true; return; } // installing: let it finish
                download.CancelAsync();
            }
        }

        // --------------------------------------------------------- versions
        static WebClient NewClient()
        {
            WebClient c = new WebClient();
            c.Headers[HttpRequestHeader.UserAgent] = "GoatBrowserSetup";
            c.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";
            return c;
        }

        void LoadVersions()
        {
            mode = Mode.Loading;
            status.ForeColor = ForeColor;
            status.Text = "Looking for versions…";
            action.Enabled = false;
            WebClient c = NewClient();
            c.DownloadStringCompleted += delegate(object s, DownloadStringCompletedEventArgs e)
            {
                c.Dispose();
                if (e.Error != null) { Fail("Couldn't reach GitHub. Check your connection."); return; }
                try { FillVersions(e.Result); }
                catch (Exception) { Fail("Couldn't read the version list from GitHub."); }
            };
            // GOAT_SETUP_API: a different release list, for testing.
            string api = Environment.GetEnvironmentVariable("GOAT_SETUP_API");
            c.DownloadStringAsync(new Uri(string.IsNullOrEmpty(api) ? "https://api.github.com/repos/" + Repo + "/releases?per_page=50" : api));
        }

        void FillVersions(string json)
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
            if (found.Count == 0) { Fail("No Goat versions are published yet."); return; }
            found.Sort(delegate(Release x, Release y) { return Compare(y.Version, x.Version); });
            found[0].Latest = true;
            versions.Items.Clear();
            foreach (Release r in found) versions.Items.Add(r);
            mode = Mode.Ready;
            versions.SelectedIndex = 0;
            versions.Enabled = true;
            action.Enabled = true;
            status.Text = "";
            ShowChoice();
        }

        // ---------------------------------------------------------- install
        void StartInstall()
        {
            Release r = versions.SelectedItem as Release;
            if (r == null) return;
            bool goingBack = installed != null && Compare(r.Version, installed) < 0;
            if (goingBack)
            {
                if (MessageBox.Show(this, "Go back from Goat " + installed + " to " + r.Version + "?\r\n\r\nOlder versions may not open a newer profile, so your bookmarks, history and logins can be reset. Export your bookmarks first if you need them.",
                        "Goat Browser setup", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK) return;
                while (GoatRunning())
                {
                    if (MessageBox.Show(this, "Close all Goat Browser windows, then click OK.", "Goat Browser setup",
                            MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;
                }
            }

            mode = Mode.Working;
            status.ForeColor = ForeColor;
            action.Enabled = false;
            versions.Enabled = false;
            bar.Style = ProgressBarStyle.Continuous;
            bar.Value = 0;
            bar.Visible = true;
            status.Text = "Downloading Goat " + r.Version + "…";
            tempFile = Path.Combine(Path.GetTempPath(), "GoatBrowser-" + r.Version + "-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");

            download = NewClient();
            download.DownloadProgressChanged += delegate(object s, DownloadProgressChangedEventArgs e)
            {
                long total = e.TotalBytesToReceive > 0 ? e.TotalBytesToReceive : r.Size;
                if (total > 0) bar.Value = (int)Math.Min(100, e.BytesReceived * 100 / total);
                status.Text = "Downloading Goat " + r.Version + "…  " + (e.BytesReceived / 1048576) + " of " + (total / 1048576) + " MB";
            };
            download.DownloadFileCompleted += delegate(object s, AsyncCompletedEventArgs e)
            {
                download.Dispose();
                download = null;
                if (e.Cancelled) { Cleanup(); return; }
                if (e.Error != null) { Cleanup(); Fail("The download failed. Check your connection."); return; }
                RunInstall(r, goingBack);
            };
            download.DownloadFileAsync(new Uri(r.Url), tempFile);
        }

        void RunInstall(Release r, bool goingBack)
        {
            bar.Style = ProgressBarStyle.Marquee;
            status.Text = "Installing Goat " + r.Version + "…";
            BackgroundWorker w = new BackgroundWorker();
            w.DoWork += delegate(object s, DoWorkEventArgs e)
            {
                FileInfo info = new FileInfo(tempFile);
                if (r.Size > 0 && info.Length != r.Size) { e.Result = "The download was incomplete."; return; }
                if (r.Sha256.Length > 0 && Sha256(tempFile) != r.Sha256) { e.Result = "The download didn't match the published file, so it wasn't installed."; return; }
                if (goingBack) RemoveNewer();
                ProcessStartInfo psi = new ProcessStartInfo(tempFile, "/S");
                psi.UseShellExecute = false;
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit();
                    e.Result = p.ExitCode == 0 ? null : "Setup couldn't finish (error " + p.ExitCode + "). Close Goat if it's open and try again.";
                }
            };
            w.RunWorkerCompleted += delegate(object s, RunWorkerCompletedEventArgs e)
            {
                Cleanup();
                string error = e.Error != null ? "Setup couldn't start: " + e.Error.Message : e.Result as string;
                if (error != null) { Fail(error); return; }
                mode = Mode.Done;
                installed = r.Version;
                bar.Visible = false;
                status.ForeColor = Color.FromArgb(26, 127, 55);
                status.Text = "Goat " + r.Version + " is installed.";
                note.Text = "You'll find Goat in the Start menu and on your desktop.";
                action.Text = "Open Goat";
                action.Enabled = true;
            };
            w.RunWorkerAsync();
        }

        // Chromium's own setup refuses to install over a newer version, so
        // remove the newer one first (profiles are kept).
        static void RemoveNewer()
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

        static bool GoatRunning()
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

        [STAThread]
        static void Main()
        {
            try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)12288; } // TLS 1.2 + 1.3
            catch (NotSupportedException) { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }
}
