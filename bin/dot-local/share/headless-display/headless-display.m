// headless-display: keep a virtual display attached while the lid is closed,
// so a closed MacBook still has a live screen for screen capture / computer use.
//
// Uses CoreGraphics' private CGVirtualDisplay API (the same one BetterDisplay
// and DeskPad use). The display exists only as long as this process holds it.
//
//   headless-display            # daemon: add display when lid closes, drop it when opened
//   headless-display --always   # keep the display attached regardless of the lid
//   headless-display --status   # print lid state and active displays, then exit
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <IOKit/IOKitLib.h>

@interface CGVirtualDisplayMode : NSObject
- (instancetype)initWithWidth:(NSUInteger)width height:(NSUInteger)height refreshRate:(double)refreshRate;
@end

@interface CGVirtualDisplaySettings : NSObject
@property(nonatomic) unsigned int hiDPI;
@property(retain, nonatomic) NSArray *modes;
@end

@interface CGVirtualDisplayDescriptor : NSObject
@property(retain, nonatomic) dispatch_queue_t queue;
@property(retain, nonatomic) NSString *name;
@property(nonatomic) unsigned int maxPixelsWide, maxPixelsHigh;
@property(nonatomic) CGSize sizeInMillimeters;
@property(nonatomic) unsigned int productID, vendorID, serialNum;
@property(copy, nonatomic) void (^terminationHandler)(id, id);
@end

@interface CGVirtualDisplay : NSObject
@property(readonly, nonatomic) CGDirectDisplayID displayID;
- (instancetype)initWithDescriptor:(CGVirtualDisplayDescriptor *)descriptor;
- (BOOL)applySettings:(CGVirtualDisplaySettings *)settings;
@end

static const NSUInteger kWidth = 1920, kHeight = 1080;

static void logf_(NSString *fmt, ...) {
  va_list args;
  va_start(args, fmt);
  NSString *msg = [[NSString alloc] initWithFormat:fmt arguments:args];
  va_end(args);
  fprintf(stderr, "%s headless-display: %s\n",
          [[NSDate.date description] UTF8String], msg.UTF8String);
}

// YES when the lid is closed. Laptops expose AppleClamshellState on IOPMrootDomain.
static BOOL lidClosed(void) {
  io_service_t root = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"));
  if (!root) return NO;
  CFTypeRef v = IORegistryEntryCreateCFProperty(root, CFSTR("AppleClamshellState"), kCFAllocatorDefault, 0);
  IOObjectRelease(root);
  BOOL closed = v && CFGetTypeID(v) == CFBooleanGetTypeID() && CFBooleanGetValue(v);
  if (v) CFRelease(v);
  return closed;
}

static CGVirtualDisplay *createDisplay(void) {
  CGVirtualDisplayDescriptor *d = [CGVirtualDisplayDescriptor new];
  d.queue = dispatch_get_main_queue();
  d.name = @"Headless Display";
  d.maxPixelsWide = kWidth;
  d.maxPixelsHigh = kHeight;
  d.sizeInMillimeters = CGSizeMake(600, 340);  // ~27": keeps 1080p at 1x scale
  d.vendorID = 0x3456;
  d.productID = 0x1234;
  d.serialNum = 0x0001;
  d.terminationHandler = ^(id a, id b) { logf_(@"display terminated by WindowServer"); };

  CGVirtualDisplay *display = [[CGVirtualDisplay alloc] initWithDescriptor:d];
  if (!display) return nil;

  CGVirtualDisplaySettings *s = [CGVirtualDisplaySettings new];
  s.hiDPI = 0;
  s.modes = @[ [[CGVirtualDisplayMode alloc] initWithWidth:kWidth height:kHeight refreshRate:60] ];
  if (![display applySettings:s]) return nil;
  return display;
}

static void printStatus(void) {
  CGDirectDisplayID ids[16];
  uint32_t n = 0;
  CGGetActiveDisplayList(16, ids, &n);
  printf("lid: %s\nactive displays: %u\n", lidClosed() ? "closed" : "open", n);
  for (uint32_t i = 0; i < n; i++)
    printf("  %u  %zux%zu%s%s\n", ids[i], CGDisplayPixelsWide(ids[i]), CGDisplayPixelsHigh(ids[i]),
           CGDisplayIsBuiltin(ids[i]) ? "  built-in" : "", CGDisplayIsMain(ids[i]) ? "  main" : "");
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    BOOL always = NO;
    for (int i = 1; i < argc; i++) {
      if (!strcmp(argv[i], "--status")) { printStatus(); return 0; }
      if (!strcmp(argv[i], "--always")) always = YES;
      else { fprintf(stderr, "usage: headless-display [--always | --status]\n"); return 2; }
    }

    __block CGVirtualDisplay *display = nil;
    void (^sync)(void) = ^{
      BOOL want = always || lidClosed();
      if (want && !display) {
        display = createDisplay();
        if (display) logf_(@"attached virtual display %u (%lux%lu)", display.displayID, kWidth, kHeight);
        else logf_(@"failed to create virtual display");
      } else if (!want && display) {
        logf_(@"lid open: detaching virtual display %u", display.displayID);
        display = nil;  // releasing it removes the display
      }
    };

    sync();
    dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, 0), 2 * NSEC_PER_SEC, NSEC_PER_SEC / 2);
    dispatch_source_set_event_handler(timer, sync);
    dispatch_resume(timer);
    [[NSRunLoop mainRunLoop] run];
  }
  return 0;
}
