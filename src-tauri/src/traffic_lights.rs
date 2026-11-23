#[cfg(target_os = "macos")]
pub use macos::install;

#[cfg(target_os = "macos")]
mod macos {
    use block2::RcBlock;
    use objc2::rc::{Retained, Weak};
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSView, NSViewFrameDidChangeNotification, NSWindow, NSWindowButton,
        NSWindowDidBecomeKeyNotification, NSWindowDidBecomeMainNotification,
        NSWindowDidChangeBackingPropertiesNotification, NSWindowDidDeminiaturizeNotification,
        NSWindowDidExitFullScreenNotification, NSWindowDidResignKeyNotification,
        NSWindowDidResignMainNotification, NSWindowDidResizeNotification, NSWindowStyleMask,
        NSWindowWillEnterFullScreenNotification,
    };
    use objc2_foundation::{
        NSNotification, NSNotificationCenter, NSNotificationName, NSObjectProtocol, NSPoint,
        NSString,
    };
    use std::cell::RefCell;
    use std::ptr::NonNull;
    use tauri::WebviewWindow;

    thread_local! {
        static TRAFFIC_LIGHTS: RefCell<Option<TrafficLights>> = const { RefCell::new(None) };
    }

    pub fn install(window: &WebviewWindow) -> Result<(), String> {
        let _main_thread =
            MainThreadMarker::new().ok_or("Title bar installation requires the main thread")?;
        let native = window.ns_window().map_err(|error| error.to_string())?;
        // Tauri owns the NSWindow; keep a weak reference for subsequent notifications.
        let native = unsafe { &*native.cast::<NSWindow>() };
        TRAFFIC_LIGHTS.with(|state| *state.borrow_mut() = Some(TrafficLights::new(native)));
        update(TrafficLights::apply);
        Ok(())
    }

    fn update(action: impl FnOnce(&mut TrafficLights)) {
        if MainThreadMarker::new().is_none() {
            return;
        }
        let _ = TRAFFIC_LIGHTS.try_with(|state| {
            // Setting a frame posts another notification synchronously.
            if let Ok(mut state) = state.try_borrow_mut() {
                if let Some(state) = state.as_mut() {
                    action(state);
                }
            }
        });
    }

    #[derive(Default)]
    struct Observers(Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>);

    impl Observers {
        fn add(
            &mut self,
            name: &NSNotificationName,
            object: &AnyObject,
            action: fn(&mut TrafficLights),
        ) {
            let block = RcBlock::new(move |_: NonNull<NSNotification>| update(action));
            let token = unsafe {
                NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
                    Some(name),
                    Some(object),
                    None,
                    &block,
                )
            };
            self.0.push(token);
        }
    }

    impl Drop for Observers {
        fn drop(&mut self) {
            let center = NSNotificationCenter::defaultCenter();
            for token in &self.0 {
                unsafe { center.removeObserver(token.as_ref()) };
            }
        }
    }

    struct TrafficLights {
        window: Weak<NSWindow>,
        button_spacing: f64,
        fullscreen: bool,
        _window_observers: Observers,
        frame_observers: Observers,
        views: Vec<Retained<NSView>>,
    }

    impl TrafficLights {
        fn new(window: &NSWindow) -> Self {
            let native_spacing = window
                .standardWindowButton(NSWindowButton::CloseButton)
                .zip(window.standardWindowButton(NSWindowButton::MiniaturizeButton))
                .map(|(close, minimize)| minimize.frame().origin.x - close.frame().origin.x);
            let button_spacing = native_spacing
                .filter(|spacing| (14.0..=40.0).contains(spacing))
                .unwrap_or(20.0);
            let mut observers = Observers::default();
            unsafe {
                for name in [
                    NSWindowDidResizeNotification,
                    NSWindowDidBecomeKeyNotification,
                    NSWindowDidResignKeyNotification,
                    NSWindowDidBecomeMainNotification,
                    NSWindowDidResignMainNotification,
                    NSWindowDidChangeBackingPropertiesNotification,
                    NSWindowDidDeminiaturizeNotification,
                ] {
                    observers.add(name, window, Self::apply);
                }
                observers.add(NSWindowWillEnterFullScreenNotification, window, |state| {
                    state.fullscreen = true;
                });
                observers.add(NSWindowDidExitFullScreenNotification, window, Self::resume);
            }
            let failed_to_enter =
                NSString::from_str("NSWindowDidFailToEnterFullScreenNotification");
            observers.add(&failed_to_enter, window, Self::resume);
            Self {
                window: Weak::new(window),
                button_spacing,
                fullscreen: false,
                _window_observers: observers,
                frame_observers: Observers::default(),
                views: Vec::new(),
            }
        }

        fn resume(&mut self) {
            self.fullscreen = false;
            self.apply();
        }

        fn observe_frames(&mut self, views: &[Retained<NSView>]) {
            if self
                .views
                .iter()
                .map(Retained::as_ptr)
                .eq(views.iter().map(Retained::as_ptr))
            {
                return;
            }
            let mut observers = Observers::default();
            for view in views {
                view.setPostsFrameChangedNotifications(true);
                observers.add(
                    unsafe { NSViewFrameDidChangeNotification },
                    view,
                    Self::apply,
                );
            }
            self.frame_observers = observers;
            self.views = views.to_vec();
        }

        fn apply(&mut self) {
            let Some(window) = self.window.load() else {
                return;
            };
            if self.fullscreen || window.styleMask().contains(NSWindowStyleMask::FullScreen) {
                return;
            }
            let (Some(close), Some(minimize), Some(zoom)) = (
                window.standardWindowButton(NSWindowButton::CloseButton),
                window.standardWindowButton(NSWindowButton::MiniaturizeButton),
                window.standardWindowButton(NSWindowButton::ZoomButton),
            ) else {
                return;
            };
            let Some(button_group) = (unsafe { close.superview() }) else {
                return;
            };
            let Some(container) = (unsafe { button_group.superview() }) else {
                return;
            };
            let buttons = [close, minimize, zoom].map(|button| button.into_super().into_super());
            self.observe_frames(&[
                container.clone(),
                button_group.clone(),
                buttons[0].clone(),
                buttons[1].clone(),
                buttons[2].clone(),
            ]);

            // Align traffic lights with the top-left sidebar header row.
            let (x, y, spacing) = (24.0, 27.0, self.button_spacing);
            let window_height = window.frame().size.height;
            let current_titlebar = container.frame();
            let mut titlebar = current_titlebar;
            titlebar.size.height = y + buttons[0].frame().size.height / 2.0 + 3.0;
            titlebar.origin.y = window_height - titlebar.size.height;
            if current_titlebar != titlebar {
                container.setFrame(titlebar);
            }

            for (index, button) in buttons.iter().enumerate() {
                let frame = button.frame();
                let center = NSPoint::new(x + index as f64 * spacing, window_height - y);
                let center = button_group.convertPoint_fromView(center, None);
                let origin = NSPoint::new(
                    center.x - frame.size.width / 2.0,
                    center.y - frame.size.height / 2.0,
                );
                if frame.origin != origin {
                    button.setFrameOrigin(origin);
                }
            }
        }
    }
}
