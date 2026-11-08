
  new QRCode(document.getElementById("qrcode"), {
    text: "https://sca-redmyre.vercel.app",
    width: 400, height: 400,
    colorDark: "#0f2456", colorLight: "#fff",
    correctLevel: QRCode.CorrectLevel.H
  });
