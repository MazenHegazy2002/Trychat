// "Claude (my API)" for Windows: opens Claude Code connected to your own API server instead of Anthropic's.
// The server address is built in; the key is asked for on first run and saved encrypted for this Windows user
// (DPAPI), never in this file. Run with --reset to enter a new key or address.
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;

class ClaudeLauncher
{
    const string DefaultUrl = "https://brandyy.shop:20128";
    static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ClaudeMyApi");
    static readonly string UrlFile = Path.Combine(Dir, "url.txt");
    static readonly string KeyFile = Path.Combine(Dir, "key.bin");

    static int Main(string[] args)
    {
        Console.Title = "Claude (my API)";
        Directory.CreateDirectory(Dir);
        bool reset = Array.IndexOf(args, "--reset") >= 0;

        string url = !reset && File.Exists(UrlFile) ? File.ReadAllText(UrlFile).Trim() : null;
        if (string.IsNullOrEmpty(url))
        {
            Console.Write("API address [" + DefaultUrl + "]: ");
            url = Console.ReadLine();
            url = string.IsNullOrWhiteSpace(url) ? DefaultUrl : url.Trim();
            // Claude Code adds /v1/messages itself, so drop a trailing /v1.
            url = url.TrimEnd('/');
            if (url.EndsWith("/v1")) url = url.Substring(0, url.Length - 3);
            File.WriteAllText(UrlFile, url);
        }

        string key = null;
        if (!reset && File.Exists(KeyFile))
        {
            try { key = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(KeyFile), null, DataProtectionScope.CurrentUser)); }
            catch { key = null; }
        }
        if (string.IsNullOrEmpty(key))
        {
            Console.Write("API key (hidden): ");
            key = ReadHidden();
            if (string.IsNullOrEmpty(key)) { Console.WriteLine("No key entered."); Pause(); return 1; }
            File.WriteAllBytes(KeyFile, ProtectedData.Protect(Encoding.UTF8.GetBytes(key), null, DataProtectionScope.CurrentUser));
            Console.WriteLine("Saved (encrypted for this Windows user).");
        }

        if (!HasClaude())
        {
            Console.WriteLine("Claude Code isn't installed yet. Installing it with Anthropic's official installer...");
            Run("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command \"irm https://claude.ai/install.ps1 | iex\"", null, null);
            string local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin");
            Environment.SetEnvironmentVariable("PATH", local + ";" + Environment.GetEnvironmentVariable("PATH"));
            if (!HasClaude()) { Console.WriteLine("The install didn't finish. Install Claude Code from https://claude.com/claude-code and run this again."); Pause(); return 1; }
        }

        Console.WriteLine("Opening Claude with " + url + " ...");
        int code = Run("cmd.exe", "/c claude", url, key);
        if (code != 0) Pause();
        return code;
    }

    static bool HasClaude()
    {
        try { return Run("cmd.exe", "/c where claude >nul 2>nul", null, null) == 0; } catch { return false; }
    }

    static int Run(string file, string arguments, string url, string key)
    {
        var psi = new ProcessStartInfo(file, arguments) { UseShellExecute = false };
        if (url != null)
        {
            psi.EnvironmentVariables["ANTHROPIC_BASE_URL"] = url;
            psi.EnvironmentVariables["ANTHROPIC_AUTH_TOKEN"] = key;
            psi.EnvironmentVariables.Remove("ANTHROPIC_API_KEY");
        }
        using (var p = Process.Start(psi)) { p.WaitForExit(); return p.ExitCode; }
    }

    static string ReadHidden()
    {
        var sb = new StringBuilder();
        while (true)
        {
            var k = Console.ReadKey(true);
            if (k.Key == ConsoleKey.Enter) { Console.WriteLine(); return sb.ToString().Trim(); }
            if (k.Key == ConsoleKey.Backspace) { if (sb.Length > 0) sb.Length--; continue; }
            if (!char.IsControl(k.KeyChar)) sb.Append(k.KeyChar);
        }
    }

    static void Pause() { Console.WriteLine("Press any key to close."); Console.ReadKey(true); }
}
