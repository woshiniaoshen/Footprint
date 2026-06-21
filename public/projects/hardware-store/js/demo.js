(function () {
    var toast = document.querySelector(".demo-toast");
    var timeout;

    function showDemoMessage() {
        clearTimeout(timeout);
        toast.textContent = "This feature is disabled in the read-only portfolio demo.";
        toast.classList.add("is-visible");
        timeout = setTimeout(function () {
            toast.classList.remove("is-visible");
        }, 2800);
    }

    document.addEventListener("click", function (event) {
        var link = event.target.closest("a");
        if (!link || link.closest(".demo-bar")) return;

        var href = link.getAttribute("href") || "";
        var isUnavailablePage = /\.(php|html)(?:[?#]|$)/i.test(href) && !/index\.html(?:[?#]|$)/i.test(href);
        var isPlaceholder = href === "#";

        if (isUnavailablePage || isPlaceholder) {
            event.preventDefault();
            showDemoMessage();
        }
    });
}());
