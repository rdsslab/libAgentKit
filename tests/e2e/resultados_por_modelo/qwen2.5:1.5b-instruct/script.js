```javascript
// jQuery para manejo del menú móvil y smooth scroll
$(document).ready(function() {
    var $body = $('body');

    // Mostrar menú móvil si se presiona en el body
    $body.click(function() {
        $body.toggleClass('menu-open');
    });

    // Scroll smooth
    $('a').click(function(e) {
        e.preventDefault();
        $body.addClass('active');
        smoothScroll();
    });

    // Smooth scroll function
    function smoothScroll() {
        var scrollPosition = $body.hasClass('active') ? '0' : '1';
        $('html, body').animate({
            scrollTop: $(document.getElementById(scrollPosition)).offset().top
        }, 1000);
    }
});
```