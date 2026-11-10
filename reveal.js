// Kept separate from script.js so the page still animates in
// even if three.js or the Marina model fails to load.

const sectionHeadings = document.querySelectorAll("section h2");
const headingObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("show");
                headingObserver.unobserve(entry.target);
            }
        });
    },
    {
        threshold: 0.3
    }
);

sectionHeadings.forEach((heading) => {
    headingObserver.observe(heading);
});

const projectCards = document.querySelectorAll(".project-card");
const cardObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("show");
                cardObserver.unobserve(entry.target);
            }
        });
    },
    {
        threshold: 0.15
    }
);

projectCards.forEach((card, index) => {
    card.style.transitionDelay = `${index * 150}ms`;

    // Remove the stagger once the card has appeared so hover feels instant
    card.addEventListener("transitionend", () => {
        card.style.transitionDelay = "";
    }, { once: true });

    cardObserver.observe(card);

    // Mouse glow
    card.addEventListener("mousemove", (event) => {
        const rect = card.getBoundingClientRect();

        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        card.style.setProperty("--mouse-x", `${x}px`);
        card.style.setProperty("--mouse-y", `${y}px`);
    });
});

(() => {
    const progress = document.createElement("div");
    progress.classList.add("progress");

    const topButton = document.createElement("button");
    topButton.className = "back-to-top";
    topButton.textContent = "Back to Top";

    document.body.append(progress, topButton);

    topButton.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const heading = document.querySelector("h1");
    if (heading) {
        const headingObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("show");
                        headingObserver.unobserve(entry.target);
                    }
                });
            },
            {
                threshold: 0.3
            }
        );

        headingObserver.observe(heading);
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });

        heading.addEventListener("blur", () => {
            heading.removeAttribute("tabindex");
        }, { once: true });
    }

    window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth"
    });
})();


let updatePending = false;

function updateScrollUI() {
    const scrollTop = window.scrollY;
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = document.querySelector(".progress");
    const topButton = document.querySelector(".back-to-top");

    if (progress) {
        progress.style.width = `${(scrollTop / scrollHeight) * 100}%`;
    }

    if (topButton) {
        if (scrollTop > 300) {
            topButton.classList.add("visible");
        } else {
            topButton.classList.remove("visible");
        }
    }

    updatePending = false;
}

window.addEventListener("scroll", () => {
    if (!updatePending) {
        updatePending = true;
        requestAnimationFrame(updateScrollUI);
    }
});